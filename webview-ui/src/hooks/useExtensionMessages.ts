import { useEffect, useRef, useState } from 'react';

import { playDoneSound, playPermissionSound, setSoundEnabled } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { extractToolName } from '../office/toolUtils.js';
import type { OfficeLayout } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import {
  createEmptyOfficeBucket,
  createOfficeBuckets,
  DEFAULT_OFFICE_ID,
  mergeOfficeCatalog,
  resolveOfficeId,
} from '../offices/officeStore.js';
import type { OfficeBucketState, OfficeDescriptor } from '../offices/officeTypes.js';
import { vscode } from '../vscodeApi.js';

interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

interface ExtensionMessageState {
  activeOfficeId: string;
  setActiveOfficeId: (officeId: string) => void;
  offices: OfficeDescriptor[];
  officeBuckets: Record<string, OfficeBucketState>;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  setWatchAllSessions: (v: boolean) => void;
  alwaysShowLabels: boolean;
  hooksEnabled: boolean;
  setHooksEnabled: (v: boolean) => void;
  hooksInfoShown: boolean;
}

function saveAgentSeats(os: OfficeState, officeId?: string): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', officeId, seats });
}

export function useExtensionMessages(
  getOfficeState: (officeId?: string) => OfficeState,
  onLayoutLoaded?: (officeId: string, layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [activeOfficeId, setActiveOfficeId] = useState(DEFAULT_OFFICE_ID);
  const [offices, setOffices] = useState<OfficeDescriptor[]>(mergeOfficeCatalog([]));
  const [officeBuckets, setOfficeBuckets] =
    useState<Record<string, OfficeBucketState>>(createOfficeBuckets());
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [externalAssetDirectories, setExternalAssetDirectories] = useState<string[]>([]);
  const [lastSeenVersion, setLastSeenVersion] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [watchAllSessions, setWatchAllSessions] = useState(false);
  const [alwaysShowLabels, setAlwaysShowLabels] = useState(false);
  const [hooksEnabled, setHooksEnabled] = useState(true);
  const [hooksInfoShown, setHooksInfoShown] = useState(true);

  const layoutReadyRef = useRef<Record<string, boolean>>({});
  const agentOfficeMapRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const pendingAgentsByOffice: Record<
      string,
      Array<{
        id: number;
        palette?: number;
        hueShift?: number;
        seatId?: string;
        folderName?: string;
      }>
    > = {};

    const resolveMessageOfficeId = (msg: { officeId?: string; id?: number }): string => {
      if (msg.officeId) {
        return resolveOfficeId(msg.officeId);
      }
      if (typeof msg.id === 'number') {
        return agentOfficeMapRef.current.get(msg.id) ?? DEFAULT_OFFICE_ID;
      }
      return DEFAULT_OFFICE_ID;
    };

    const updateOfficeBucket = (
      officeId: string,
      updater: (bucket: OfficeBucketState) => OfficeBucketState,
    ) => {
      setOfficeBuckets((prev) => {
        const current = prev[officeId] ?? createEmptyOfficeBucket();
        return { ...prev, [officeId]: updater(current) };
      });
    };

    const handler = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'officesLoaded') {
        const merged = mergeOfficeCatalog((msg.offices as OfficeDescriptor[] | undefined) ?? []);
        setOffices(merged);
        setActiveOfficeId((prev) =>
          merged.some((office) => office.officeId === prev) ? prev : DEFAULT_OFFICE_ID,
        );
      } else if (msg.type === 'layoutLoaded') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string });
        const os = getOfficeState(officeId);
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current[officeId] && officeId === activeOfficeId && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(officeId, layout);
        } else {
          onLayoutLoaded?.(officeId, os.getLayout());
        }
        for (const p of pendingAgentsByOffice[officeId] ?? []) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
        }
        pendingAgentsByOffice[officeId] = [];
        layoutReadyRef.current[officeId] = true;
        updateOfficeBucket(officeId, (bucket) => ({
          ...bucket,
          layoutReady: true,
          layoutWasReset: bucket.layoutWasReset || Boolean(msg.wasReset),
        }));
        if (os.characters.size > 0) {
          saveAgentSeats(os, officeId);
        }
      } else if (msg.type === 'agentCreated') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        agentOfficeMapRef.current.set(id, officeId);
        const folderName = msg.folderName as string | undefined;
        const isTeammate = msg.isTeammate as boolean | undefined;
        const teammateName = msg.teammateName as string | undefined;
        const teammateParentId = msg.parentAgentId as number | undefined;
        const teamName = msg.teamName as string | undefined;
        updateOfficeBucket(officeId, (bucket) => ({
          ...bucket,
          agents: bucket.agents.includes(id) ? bucket.agents : [...bucket.agents, id],
          selectedAgent: !isTeammate ? id : bucket.selectedAgent,
        }));
        if (isTeammate && teammateParentId !== undefined) {
          const parentCh = os.characters.get(teammateParentId);
          const palette = parentCh ? parentCh.palette : undefined;
          const hueShift = parentCh ? parentCh.hueShift : undefined;
          os.addAgent(id, palette, hueShift, undefined, undefined, parentCh?.folderName);
          // Set team metadata on the character
          const ch = os.characters.get(id);
          if (ch) {
            ch.leadAgentId = teammateParentId;
            ch.teamName = teamName ?? parentCh?.teamName;
            ch.agentName = teammateName;
          }
        } else {
          os.addAgent(id, undefined, undefined, undefined, undefined, folderName);
        }
        saveAgentSeats(os, officeId);
      } else if (msg.type === 'agentClosed') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        agentOfficeMapRef.current.delete(id);
        updateOfficeBucket(officeId, (bucket) => {
          const nextAgentTools = { ...bucket.agentTools };
          delete nextAgentTools[id];
          const nextAgentStatuses = { ...bucket.agentStatuses };
          delete nextAgentStatuses[id];
          const nextSubagentTools = { ...bucket.subagentTools };
          delete nextSubagentTools[id];
          return {
            ...bucket,
            agents: bucket.agents.filter((a) => a !== id),
            selectedAgent: bucket.selectedAgent === id ? null : bucket.selectedAgent,
            agentTools: nextAgentTools,
            agentStatuses: nextAgentStatuses,
            subagentTools: nextSubagentTools,
            subagentCharacters: bucket.subagentCharacters.filter((s) => s.parentAgentId !== id),
          };
        });
        os.removeAllSubagents(id);
        os.removeAgent(id);
      } else if (msg.type === 'existingAgents') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string });
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<
          number,
          { palette?: number; hueShift?: number; seatId?: string }
        >;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        pendingAgentsByOffice[officeId] ??= [];
        for (const id of incoming) {
          agentOfficeMapRef.current.set(id, officeId);
          const m = meta[id];
          pendingAgentsByOffice[officeId].push({
            id,
            palette: m?.palette,
            hueShift: m?.hueShift,
            seatId: m?.seatId,
            folderName: folderNames[id],
          });
        }
        updateOfficeBucket(officeId, (bucket) => {
          const ids = new Set(bucket.agents);
          const merged = [...bucket.agents];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return { ...bucket, agents: merged.sort((a, b) => a - b) };
        });
      } else if (msg.type === 'agentToolStart') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        const permissionActive = msg.permissionActive as boolean | undefined;
        updateOfficeBucket(officeId, (bucket) => {
          const list = bucket.agentTools[id] || [];
          if (list.some((t) => t.toolId === toolId)) return bucket;
          return {
            ...bucket,
            agentTools: {
              ...bucket.agentTools,
              [id]: [
                ...list,
                { toolId, status, done: false, permissionWait: permissionActive || false },
              ],
            },
          };
        });
        const toolName = (msg.toolName as string | undefined) ?? extractToolName(status);
        os.setAgentTool(id, toolName);
        os.setAgentActive(id, true);
        // Don't clear the permission bubble if the hook already confirmed permission is needed
        if (!permissionActive) {
          os.clearPermissionBubble(id);
        }
        // Create sub-agent character for Task/Agent tool subtasks.
        // In tmux / inline teams mode, Agent tool has run_in_background=true -- those
        // are handled via the independent teammate path (onTeammateDetected), not here.
        // runInBackground gates them out so we don't create ghost sub-agents for them.
        //
        // Skip creation for synthetic hook-ids. Later SubagentStop/subagentClear use
        // the REAL tool id from JSONL; creating with a synthetic id would orphan the
        // sub-agent (mismatched keys). JSONL's agentToolStart (with real id) handles
        // creation in both hooks and heuristic modes -- ~500ms delay vs instant hook.
        const runInBackground = msg.runInBackground as boolean | undefined;
        if (
          (toolName === 'Task' || toolName === 'Agent') &&
          !runInBackground &&
          !toolId.startsWith('hook-')
        ) {
          const label = status.startsWith('Subtask:') ? status.slice('Subtask:'.length).trim() : '';
          const subId = os.addSubagent(id, toolId);
          updateOfficeBucket(officeId, (bucket) => {
            if (bucket.subagentCharacters.some((s) => s.id === subId)) return bucket;
            return {
              ...bucket,
              subagentCharacters: [
                ...bucket.subagentCharacters,
                { id: subId, parentAgentId: id, parentToolId: toolId, label },
              ],
            };
          });
        }
      } else if (msg.type === 'agentToolDone') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        updateOfficeBucket(officeId, (bucket) => {
          const list = bucket.agentTools[id];
          if (!list) return bucket;
          return {
            ...bucket,
            agentTools: {
              ...bucket.agentTools,
              [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
        });
      } else if (msg.type === 'agentToolsClear') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        updateOfficeBucket(officeId, (bucket) => {
          const nextAgentTools = { ...bucket.agentTools };
          delete nextAgentTools[id];
          const nextSubagentTools = { ...bucket.subagentTools };
          delete nextSubagentTools[id];
          const clearCh = os.characters.get(id);
          const hasInlineTeammates =
            clearCh?.teamName && clearCh?.isTeamLead && !clearCh?.teamUsesTmux;
          return {
            ...bucket,
            agentTools: nextAgentTools,
            subagentTools: nextSubagentTools,
            subagentCharacters: hasInlineTeammates
              ? bucket.subagentCharacters
              : bucket.subagentCharacters.filter((s) => s.parentAgentId !== id),
          };
        });
        const clearCh = os.characters.get(id);
        const hasInlineTeammates =
          clearCh?.teamName && clearCh?.isTeamLead && !clearCh?.teamUsesTmux;
        if (!hasInlineTeammates) {
          os.removeAllSubagents(id);
        }
        os.setAgentTool(id, null);
        os.clearPermissionBubble(id);
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        updateOfficeBucket(officeId, (bucket) => ({ ...bucket, selectedAgent: id }));
      } else if (msg.type === 'agentStatus') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        const status = msg.status as string;
        updateOfficeBucket(officeId, (bucket) => {
          if (status === 'active') {
            if (!(id in bucket.agentStatuses)) return bucket;
            const next = { ...bucket.agentStatuses };
            delete next[id];
            return { ...bucket, agentStatuses: next };
          }
          return { ...bucket, agentStatuses: { ...bucket.agentStatuses, [id]: status } };
        });
        os.setAgentActive(id, status === 'active');
        if (status === 'waiting') {
          os.showWaitingBubble(id);
          playDoneSound();
        }
      } else if (msg.type === 'agentToolPermission') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        updateOfficeBucket(officeId, (bucket) => {
          const list = bucket.agentTools[id];
          if (!list) return bucket;
          return {
            ...bucket,
            agentTools: {
              ...bucket.agentTools,
              [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
            },
          };
        });
        os.showPermissionBubble(id);
        playPermissionSound();
      } else if (msg.type === 'subagentToolPermission') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        updateOfficeBucket(officeId, (bucket) => {
          const list = bucket.agentTools[id];
          if (!list) return bucket;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return bucket;
          return {
            ...bucket,
            agentTools: {
              ...bucket.agentTools,
              [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
            },
          };
        });
        os.clearPermissionBubble(id);
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId);
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        updateOfficeBucket(officeId, (bucket) => {
          const agentSubs = bucket.subagentTools[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return bucket;
          return {
            ...bucket,
            subagentTools: {
              ...bucket.subagentTools,
              [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
            },
          };
        });
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          const subToolName = extractToolName(status);
          os.setAgentTool(subId, subToolName);
          os.setAgentActive(subId, true);
        }
      } else if (msg.type === 'subagentToolDone') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        updateOfficeBucket(officeId, (bucket) => {
          const agentSubs = bucket.subagentTools[id];
          if (!agentSubs) return bucket;
          const list = agentSubs[parentToolId];
          if (!list) return bucket;
          return {
            ...bucket,
            subagentTools: {
              ...bucket.subagentTools,
              [id]: {
                ...agentSubs,
                [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
              },
            },
          };
        });
      } else if (msg.type === 'subagentClear') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        updateOfficeBucket(officeId, (bucket) => {
          const agentSubs = bucket.subagentTools[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return bucket;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...bucket.subagentTools };
            delete outer[id];
            return {
              ...bucket,
              subagentTools: outer,
              subagentCharacters: bucket.subagentCharacters.filter(
                (s) => !(s.parentAgentId === id && s.parentToolId === parentToolId),
              ),
            };
          }
          return {
            ...bucket,
            subagentTools: { ...bucket.subagentTools, [id]: next },
            subagentCharacters: bucket.subagentCharacters.filter(
              (s) => !(s.parentAgentId === id && s.parentToolId === parentToolId),
            ),
          };
        });
        os.removeSubagent(id, parentToolId);
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} wall tile set(s)`);
        setWallSprites(sets);
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[];
        setWorkspaceFolders(folders);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
        if (typeof msg.watchAllSessions === 'boolean') {
          setWatchAllSessions(msg.watchAllSessions as boolean);
        }
        if (typeof msg.alwaysShowLabels === 'boolean') {
          setAlwaysShowLabels(msg.alwaysShowLabels as boolean);
        }
        if (typeof msg.hooksEnabled === 'boolean') {
          setHooksEnabled(msg.hooksEnabled as boolean);
        }
        if (typeof msg.hooksInfoShown === 'boolean') {
          setHooksInfoShown(msg.hooksInfoShown as boolean);
        }
        if (Array.isArray(msg.externalAssetDirectories)) {
          setExternalAssetDirectories(msg.externalAssetDirectories as string[]);
        }
        if (typeof msg.lastSeenVersion === 'string') {
          setLastSeenVersion(msg.lastSeenVersion as string);
        }
        if (typeof msg.extensionVersion === 'string') {
          setExtensionVersion(msg.extensionVersion as string);
        }
      } else if (msg.type === 'externalAssetDirectoriesUpdated') {
        if (Array.isArray(msg.dirs)) {
          setExternalAssetDirectories(msg.dirs as string[]);
        }
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      } else if (msg.type === 'agentTeamInfo') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        os.setTeamInfo(
          id,
          msg.teamName as string | undefined,
          msg.agentName as string | undefined,
          msg.isTeamLead as boolean | undefined,
          msg.leadAgentId as number | undefined,
          msg.teamUsesTmux as boolean | undefined,
        );
      } else if (msg.type === 'agentTokenUsage') {
        const officeId = resolveMessageOfficeId(msg as { officeId?: string; id?: number });
        const os = getOfficeState(officeId);
        const id = msg.id as number;
        os.setAgentTokens(id, msg.inputTokens as number, msg.outputTokens as number);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOfficeState]);

  return {
    activeOfficeId,
    setActiveOfficeId,
    offices,
    officeBuckets,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
  };
}
