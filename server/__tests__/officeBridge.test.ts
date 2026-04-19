import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { OfficeDescriptor } from '../../src/offices/officeTypes.js';
import type { OpenCodeCliSession } from '../../src/opencode/openCodeSessionTypes.js';
import type { AgentState, PersistedAgent } from '../../src/types.js';

const HOME_PREFIX = 'pixel-agents-office-bridge-';

function createOffice(overrides: Partial<OfficeDescriptor> = {}): OfficeDescriptor {
  return {
    officeId: 'opencode:root:root-1',
    storageId: 'opencode-root-1234567890abcdef',
    providerId: 'opencode',
    rootSessionId: 'root-1',
    title: 'Root One',
    directory: '/workspace/root-one',
    status: 'active',
    lastSeenAt: 50_000,
    persistenceMode: 'persistent',
    ...overrides,
  };
}

function createSessionRow(overrides: Partial<OpenCodeCliSession> = {}): OpenCodeCliSession {
  return {
    id: 'root-1',
    title: 'Root One',
    directory: '/workspace/root-one',
    updated: 50_000,
    ...overrides,
  };
}

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 7,
    sessionId: 'session-7',
    officeId: 'opencode:root:root-1',
    rootSessionId: 'root-1',
    parentSessionId: 'parent-1',
    providerId: 'opencode',
    isExternal: true,
    projectDir: '/workspace/root-one',
    jsonlFile: '/workspace/root-one/session-7.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

describe('Office bridge helpers', () => {
  it('routes Claude default saves to legacy persistence and OpenCode saves to office-scoped files while posting the office catalog', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), HOME_PREFIX));
    vi.resetModules();
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return {
        ...actual,
        homedir: () => fakeHome,
      };
    });

    const bridgeModulePromise = import('../../src/offices/officeBridge.js');
    const persistenceModulePromise = import('../../src/offices/officeLayoutPersistence.js');

    await expect(bridgeModulePromise).resolves.toBeTruthy();
    await expect(persistenceModulePromise).resolves.toBeTruthy();

    const bridgeModule = await bridgeModulePromise;
    const persistenceModule = await persistenceModulePromise;

    try {
      const defaultLayout = { version: 1, cols: 1, rows: 1, tiles: ['claude'] };
      const officeLayout = { version: 1, cols: 2, rows: 1, tiles: ['opencode', 'desk'] };
      const defaultSeats = { '7': { palette: 3, seatId: 'chair-a' } };
      const officeSeats = { '8': { palette: 4, seatId: 'chair-b' } };
      const offices = [createOffice()];
      const posted: unknown[] = [];
      const legacyLayoutWrites: Record<string, unknown>[] = [];
      const ownWrites: string[] = [];
      let legacySeatsStore: Record<string, unknown> = {};

      const bridge = new bridgeModule.OfficeBridgeController({
        officeRegistry: { listOffices: () => offices },
        postMessage(message: unknown): void {
          posted.push(message);
        },
        writeLegacyLayout(layout: Record<string, unknown>): void {
          legacyLayoutWrites.push(layout);
        },
        markLegacyLayoutOwnWrite(): void {
          ownWrites.push('claude');
        },
        readLegacySeats(): Record<string, unknown> {
          return legacySeatsStore;
        },
        writeLegacySeats(seats: Record<string, unknown>): void {
          legacySeatsStore = seats;
        },
      });

      bridge.postOfficeCatalog();
      bridge.startOpenCodeRefreshLoop();

      bridge.saveLayout({ officeId: 'claude:default', layout: defaultLayout });
      bridge.saveLayout({ officeId: 'opencode:root:root-1', layout: officeLayout });
      bridge.saveAgentSeats({ officeId: 'claude:default', seats: defaultSeats });
      bridge.saveAgentSeats({ officeId: 'opencode:root:root-1', seats: officeSeats });

      expect(posted).toEqual([
        {
          type: 'officesLoaded',
          offices,
        },
      ]);
      expect(bridge.getRefreshLoopState()).toEqual({
        started: true,
      });
      expect(legacyLayoutWrites).toEqual([defaultLayout]);
      expect(ownWrites).toEqual(['claude']);
      expect(bridge.readAgentSeats('claude:default')).toEqual(defaultSeats);
      expect(bridge.readAgentSeats('opencode:root:root-1')).toEqual(officeSeats);
      expect(persistenceModule.readOfficeLayoutFromFile('opencode-root-1234567890abcdef')).toEqual(
        officeLayout,
      );
      expect(persistenceModule.readOfficeSeatsFromFile('opencode-root-1234567890abcdef')).toEqual(
        officeSeats,
      );
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      vi.doUnmock('node:os');
    }
  });

  it('hydrates non-Claude offices with saved layout fallback and office-scoped empty runtime bootstrap', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), HOME_PREFIX));
    vi.resetModules();
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return {
        ...actual,
        homedir: () => fakeHome,
      };
    });

    const bridgeModulePromise = import('../../src/offices/officeBridge.js');
    const persistenceModulePromise = import('../../src/offices/officeLayoutPersistence.js');

    await expect(bridgeModulePromise).resolves.toBeTruthy();
    await expect(persistenceModulePromise).resolves.toBeTruthy();

    const bridgeModule = await bridgeModulePromise;
    const persistenceModule = await persistenceModulePromise;

    try {
      const fallbackLayout = { version: 1, cols: 1, rows: 1, tiles: ['fallback'] };
      const savedLayout = { version: 1, cols: 2, rows: 1, tiles: ['saved', 'desk'] };
      const offices = [
        createOffice(),
        createOffice({
          officeId: 'opencode:root:root-2',
          storageId: 'opencode-root-fedcba0987654321',
          rootSessionId: 'root-2',
          title: 'Root Two',
          directory: '/workspace/root-two',
        }),
      ];
      const posted: unknown[] = [];

      persistenceModule.writeOfficeLayoutToFile('opencode-root-1234567890abcdef', savedLayout);

      const bridge = new bridgeModule.OfficeBridgeController({
        officeRegistry: { listOffices: () => offices },
        postMessage(message: unknown): void {
          posted.push(message);
        },
        writeLegacyLayout(): void {},
        markLegacyLayoutOwnWrite(): void {},
      });

      bridge.hydrateOpenCodeOffices(fallbackLayout);

      expect(posted).toEqual([
        {
          type: 'layoutLoaded',
          officeId: 'opencode:root:root-1',
          layout: savedLayout,
        },
        {
          type: 'existingAgents',
          officeId: 'opencode:root:root-1',
          agents: [],
          agentMeta: {},
          folderNames: {},
          externalAgents: {},
        },
        {
          type: 'layoutLoaded',
          officeId: 'opencode:root:root-2',
          layout: fallbackLayout,
        },
        {
          type: 'existingAgents',
          officeId: 'opencode:root:root-2',
          agents: [],
          agentMeta: {},
          folderNames: {},
          externalAgents: {},
        },
      ]);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      vi.doUnmock('node:os');
    }
  });

  it('preserves office metadata when serializing persisted agents and restoring agent state', async () => {
    vi.mock('vscode', () => ({
      workspace: {
        workspaceFolders: undefined,
      },
      window: {
        terminals: [],
      },
    }));

    const bridgeModulePromise = import('../../src/offices/officeBridge.js');
    const agentManagerModulePromise = import('../../src/agentManager.js');

    await expect(bridgeModulePromise).resolves.toBeTruthy();
    await expect(agentManagerModulePromise).resolves.toBeTruthy();

    const bridgeModule = await bridgeModulePromise;
    const agentManagerModule = await agentManagerModulePromise;
    const serialized = agentManagerModule.toPersistedAgent(createAgent());

    expect(serialized).toMatchObject({
      id: 7,
      sessionId: 'session-7',
      officeId: 'opencode:root:root-1',
      rootSessionId: 'root-1',
      parentSessionId: 'parent-1',
      providerId: 'opencode',
    } satisfies Partial<PersistedAgent>);

    const restored = agentManagerModule.restoreAgentState(
      {
        ...serialized,
        terminalName: '',
        isExternal: true,
        jsonlFile: '/workspace/root-one/session-7.jsonl',
        projectDir: '/workspace/root-one',
      },
      undefined,
    );

    expect(restored.officeId).toBe('opencode:root:root-1');
    expect(restored.rootSessionId).toBe('root-1');
    expect(restored.parentSessionId).toBe('parent-1');
    expect(restored.providerId).toBe('opencode');

    const defaultOffice = bridgeModule.resolveOfficePersistenceTarget('claude:default', []);
    const openCodeOffice = bridgeModule.resolveOfficePersistenceTarget('opencode:root:root-1', [
      createOffice(),
    ]);

    expect(defaultOffice).toEqual({
      officeId: 'claude:default',
      kind: 'legacy-claude',
    });
    expect(openCodeOffice).toEqual({
      officeId: 'opencode:root:root-1',
      kind: 'office-storage',
      office: createOffice(),
    });
  });

  it('replays existing agents and runtime status messages with office-scoped payloads for non-Claude offices', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      workspace: {
        workspaceFolders: undefined,
      },
      window: {
        terminals: [],
      },
    }));

    const agentManagerModulePromise = import('../../src/agentManager.js');

    await expect(agentManagerModulePromise).resolves.toBeTruthy();

    const agentManagerModule = await agentManagerModulePromise;
    const posted: Array<Record<string, unknown>> = [];
    const webview = {
      postMessage(message: Record<string, unknown>) {
        posted.push(message);
      },
    };
    const agents = new Map<number, AgentState>();
    const agent = createAgent({
      id: 7,
      officeId: 'opencode:root:root-1',
      isWaiting: true,
    });
    agent.activeToolStatuses.set('tool-1', 'Reading file');
    agent.activeToolNames.set('tool-1', 'Read');
    agent.inputTokens = 12;
    agent.outputTokens = 34;
    agents.set(7, agent);

    const context = {
      workspaceState: {
        get: vi.fn().mockReturnValue({
          '7': { palette: 3, seatId: 'chair-a' },
        }),
      },
    };

    agentManagerModule.sendExistingAgents(
      agents,
      context as unknown as import('vscode').ExtensionContext,
      webview as unknown as import('vscode').Webview,
    );
    agentManagerModule.sendCurrentAgentStatuses(
      agents,
      webview as unknown as import('vscode').Webview,
    );

    expect(posted).toEqual([
      {
        type: 'existingAgents',
        officeId: 'opencode:root:root-1',
        agents: [7],
        agentMeta: {
          '7': { palette: 3, seatId: 'chair-a' },
        },
        folderNames: {},
        externalAgents: { 7: true },
      },
      {
        type: 'agentToolStart',
        officeId: 'opencode:root:root-1',
        id: 7,
        toolId: 'tool-1',
        status: 'Reading file',
        toolName: 'Read',
      },
      {
        type: 'agentStatus',
        officeId: 'opencode:root:root-1',
        id: 7,
        status: 'waiting',
      },
      {
        type: 'agentTokenUsage',
        officeId: 'opencode:root:root-1',
        id: 7,
        inputTokens: 12,
        outputTokens: 34,
      },
    ]);
  });

  it('reconciles OpenCode root snapshots into OfficeRegistry before posting the catalog', async () => {
    const discoveryModulePromise = import('../../src/opencode/openCodeDiscovery.js');
    const registryModulePromise = import('../../src/offices/officeRegistry.js');
    const bridgeModulePromise = import('../../src/offices/officeBridge.js');

    await expect(discoveryModulePromise).resolves.toBeTruthy();
    await expect(registryModulePromise).resolves.toBeTruthy();
    await expect(bridgeModulePromise).resolves.toBeTruthy();

    const registryModule = await registryModulePromise;
    const bridgeModule = await bridgeModulePromise;
    const posted: unknown[] = [];
    const registry = new registryModule.OfficeRegistry();
    const bridge = new bridgeModule.OfficeBridgeController({
      officeRegistry: registry,
      postMessage(message: unknown): void {
        posted.push(message);
      },
      writeLegacyLayout(): void {},
      markLegacyLayoutOwnWrite(): void {},
    });

    bridgeModule.reconcileOpenCodeOfficeCatalog({
      officeRegistry: registry,
      sessions: [
        createSessionRow(),
        createSessionRow({
          id: 'child-1',
          title: 'Child One',
          directory: '/workspace/root-one/packages/a',
          updated: 50_100,
          parentId: 'root-1',
        }),
      ],
      activeRootSessionIds: new Set(['root-1']),
      now: 60_000,
    });

    bridge.postOfficeCatalog();

    expect(posted).toEqual([
      {
        type: 'officesLoaded',
        offices: [
          {
            officeId: 'opencode:root:root-1',
            storageId: expect.stringMatching(/^opencode-root-[0-9a-f]{16}$/),
            providerId: 'opencode',
            rootSessionId: 'root-1',
            title: 'Root One',
            directory: '/workspace/root-one',
            status: 'active',
            lastSeenAt: 60_000,
            persistenceMode: 'persistent',
          },
        ],
      },
    ]);
  });

  it('fails closed for unknown non-default office ids instead of falling back to Claude legacy persistence', async () => {
    const bridgeModulePromise = import('../../src/offices/officeBridge.js');

    await expect(bridgeModulePromise).resolves.toBeTruthy();

    const bridgeModule = await bridgeModulePromise;
    const legacyLayoutWrites: Record<string, unknown>[] = [];
    let legacySeatsStore: Record<string, unknown> = { '7': { palette: 9, seatId: 'claude-seat' } };
    const bridge = new bridgeModule.OfficeBridgeController({
      officeRegistry: { listOffices: () => [createOffice()] },
      postMessage(): void {},
      writeLegacyLayout(layout: Record<string, unknown>): void {
        legacyLayoutWrites.push(layout);
      },
      markLegacyLayoutOwnWrite(): void {},
      readLegacySeats(): Record<string, unknown> {
        return legacySeatsStore;
      },
      writeLegacySeats(seats: Record<string, unknown>): void {
        legacySeatsStore = seats;
      },
    });

    bridge.saveLayout({
      officeId: 'opencode:root:missing-root',
      layout: { version: 1, cols: 1, rows: 1, tiles: ['missing'] },
    });
    bridge.saveAgentSeats({
      officeId: 'opencode:root:missing-root',
      seats: { '99': { palette: 2, seatId: 'missing-seat' } },
    });

    expect(bridge.readAgentSeats('opencode:root:missing-root')).toEqual({});
    expect(legacyLayoutWrites).toEqual([]);
    expect(legacySeatsStore).toEqual({ '7': { palette: 9, seatId: 'claude-seat' } });
  });
});
