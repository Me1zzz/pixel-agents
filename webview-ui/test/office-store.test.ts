import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSaveLayoutMessage,
  createEditorSessionStore,
  createLayoutCheckpointStore,
  resolveEditorOfficeContext,
} from '../src/hooks/useEditorActions.ts';
import type { OfficeLayout } from '../src/office/types.ts';
import {
  createOfficeBuckets,
  DEFAULT_OFFICE_ID,
  getBucket,
  listOfficeOptions,
  mergeOfficeCatalog,
  resolveOfficeId,
} from '../src/offices/officeStore.ts';
import type { OfficeBucketState, OfficeDescriptor } from '../src/offices/officeTypes.ts';

function createDescriptor(overrides: Partial<OfficeDescriptor> = {}): OfficeDescriptor {
  return {
    officeId: overrides.officeId ?? 'opencode:root:root-1',
    storageId: overrides.storageId ?? 'storage-1',
    providerId: overrides.providerId ?? 'opencode',
    rootSessionId: overrides.rootSessionId ?? 'root-1',
    title: overrides.title ?? 'Alpha Office',
    directory: overrides.directory ?? 'C:/alpha',
    status: overrides.status ?? 'active',
    lastSeenAt: overrides.lastSeenAt ?? 100,
    persistenceMode: overrides.persistenceMode ?? 'persistent',
  };
}

function createBucketState(label: string): OfficeBucketState {
  return {
    agents: [1],
    selectedAgent: 1,
    agentTools: { 1: [{ toolId: `${label}-tool`, status: label, done: false }] },
    agentStatuses: { 1: label },
    subagentTools: {},
    subagentCharacters: [],
    layoutReady: label === 'claude',
    layoutWasReset: false,
  };
}

test('office store keeps Claude default office and separate office buckets', () => {
  const initialBuckets = createOfficeBuckets();
  assert.deepEqual(Object.keys(initialBuckets), [DEFAULT_OFFICE_ID]);

  const alphaOffice = createDescriptor();
  const mergedCatalog = mergeOfficeCatalog([alphaOffice]);
  assert.deepEqual(
    mergedCatalog.map((office) => office.officeId),
    [DEFAULT_OFFICE_ID, alphaOffice.officeId],
  );

  const claudeBuckets = {
    ...initialBuckets,
    [DEFAULT_OFFICE_ID]: createBucketState('claude'),
  };
  const claudeBucket = getBucket(claudeBuckets, undefined, () => createBucketState('unused'));
  const alphaBuckets = {
    ...claudeBuckets,
    [alphaOffice.officeId]: createBucketState('alpha'),
  };
  const alphaBucket = getBucket(alphaBuckets, alphaOffice.officeId, () => createBucketState('new'));

  assert.equal(resolveOfficeId(undefined), DEFAULT_OFFICE_ID);
  assert.equal(resolveOfficeId(alphaOffice.officeId), alphaOffice.officeId);
  assert.deepEqual(claudeBucket.agents, [1]);
  assert.deepEqual(alphaBucket.agents, [1]);
  assert.equal(claudeBucket.agentStatuses[1], 'claude');
  assert.equal(alphaBucket.agentStatuses[1], 'alpha');
  assert.notEqual(claudeBucket, alphaBucket);

  assert.deepEqual(
    listOfficeOptions(mergedCatalog).map((office) => ({
      officeId: office.officeId,
      label: office.label,
      isDefault: office.isDefault,
    })),
    [
      { officeId: DEFAULT_OFFICE_ID, label: 'Claude', isDefault: true },
      { officeId: alphaOffice.officeId, label: 'Alpha Office', isDefault: false },
    ],
  );
});

test('editor actions resolve the active office and include officeId in save messages', () => {
  const defaultOffice = { name: 'claude-default' };
  const opencodeOffice = { name: 'opencode-alpha' };
  const seenOfficeIds: string[] = [];

  const context = resolveEditorOfficeContext(
    () => 'opencode:root:alpha',
    (officeId) => {
      const resolvedOfficeId = officeId ?? DEFAULT_OFFICE_ID;
      seenOfficeIds.push(resolvedOfficeId);
      return (resolvedOfficeId === DEFAULT_OFFICE_ID ? defaultOffice : opencodeOffice) as never;
    },
  );

  assert.equal(context.officeId, 'opencode:root:alpha');
  assert.equal(context.officeState, opencodeOffice);
  assert.deepEqual(seenOfficeIds, ['opencode:root:alpha']);

  const layout: OfficeLayout = {
    version: 1,
    cols: 1,
    rows: 1,
    tiles: [1],
    furniture: [],
  };

  assert.deepEqual(buildSaveLayoutMessage('opencode:root:alpha', layout), {
    type: 'saveLayout',
    officeId: 'opencode:root:alpha',
    layout,
  });
});

test('editor checkpoints stay isolated per office', () => {
  const checkpoints = createLayoutCheckpointStore();

  const claudeLayout: OfficeLayout = {
    version: 1,
    cols: 1,
    rows: 1,
    tiles: [1],
    furniture: [],
  };

  const opencodeLayout: OfficeLayout = {
    version: 1,
    cols: 2,
    rows: 1,
    tiles: [1, 1],
    furniture: [],
  };

  checkpoints.set(DEFAULT_OFFICE_ID, claudeLayout);
  checkpoints.set('opencode:root:alpha', opencodeLayout);

  const savedClaude = checkpoints.get(DEFAULT_OFFICE_ID);
  const savedOpenCode = checkpoints.get('opencode:root:alpha');

  assert.deepEqual(savedClaude, claudeLayout);
  assert.deepEqual(savedOpenCode, opencodeLayout);
  assert.notDeepEqual(savedClaude, savedOpenCode);

  claudeLayout.tiles[0] = 255;
  opencodeLayout.tiles[0] = 255;

  assert.deepEqual(checkpoints.get(DEFAULT_OFFICE_ID), {
    version: 1,
    cols: 1,
    rows: 1,
    tiles: [1],
    furniture: [],
  });
  assert.deepEqual(checkpoints.get('opencode:root:alpha'), {
    version: 1,
    cols: 2,
    rows: 1,
    tiles: [1, 1],
    furniture: [],
  });
});

test('editor sessions stay isolated per office', () => {
  const sessions = createEditorSessionStore(() => 2);

  const claudeSession = sessions.get(DEFAULT_OFFICE_ID);
  const alphaSession = sessions.get('opencode:root:alpha');

  claudeSession.isEditMode = true;
  claudeSession.isDirty = true;
  claudeSession.zoom = 3;
  claudeSession.pan.x = 12;
  claudeSession.editorState.activeTool = 'tile_paint';
  claudeSession.checkpoints.set(DEFAULT_OFFICE_ID, {
    version: 1,
    cols: 1,
    rows: 1,
    tiles: [1],
    furniture: [],
  });

  alphaSession.isEditMode = false;
  alphaSession.isDirty = false;
  alphaSession.zoom = 7;
  alphaSession.pan.x = -4;
  alphaSession.editorState.activeTool = 'select';
  alphaSession.checkpoints.set('opencode:root:alpha', {
    version: 1,
    cols: 2,
    rows: 1,
    tiles: [1, 1],
    furniture: [],
  });

  assert.notEqual(claudeSession, alphaSession);
  assert.notEqual(claudeSession.editorState, alphaSession.editorState);
  assert.deepEqual(
    {
      editMode: claudeSession.isEditMode,
      dirty: claudeSession.isDirty,
      zoom: claudeSession.zoom,
      panX: claudeSession.pan.x,
      tool: claudeSession.editorState.activeTool,
      checkpointCols: claudeSession.checkpoints.get(DEFAULT_OFFICE_ID)?.cols,
    },
    { editMode: true, dirty: true, zoom: 3, panX: 12, tool: 'tile_paint', checkpointCols: 1 },
  );
  assert.deepEqual(
    {
      editMode: alphaSession.isEditMode,
      dirty: alphaSession.isDirty,
      zoom: alphaSession.zoom,
      panX: alphaSession.pan.x,
      tool: alphaSession.editorState.activeTool,
      checkpointCols: alphaSession.checkpoints.get('opencode:root:alpha')?.cols,
    },
    {
      editMode: false,
      dirty: false,
      zoom: 7,
      panX: -4,
      tool: 'select',
      checkpointCols: 2,
    },
  );
  assert.equal(sessions.get(DEFAULT_OFFICE_ID), claudeSession);
  assert.equal(sessions.get('opencode:root:alpha'), alphaSession);
});
