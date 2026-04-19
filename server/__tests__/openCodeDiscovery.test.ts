import { describe, expect, it, vi } from 'vitest';

describe('OpenCode discovery helpers', () => {
  it('parses CLI history rows and reconciles only active root snapshots', async () => {
    const discoveryModulePromise = import('../../src/opencode/openCodeDiscovery.js');

    await expect(discoveryModulePromise).resolves.toBeTruthy();

    const { buildOpenCodeRootSnapshots, parseOpenCodeSessionList } = await discoveryModulePromise;
    const sessions = parseOpenCodeSessionList(
      JSON.stringify([
        {
          id: 'inactive-root',
          title: 'Inactive root',
          directory: '/repo/inactive',
          updated: 100,
        },
        {
          id: 'active-root',
          title: 'Active root',
          directory: '/repo/active',
          updated: 200,
        },
        {
          id: 'child-a',
          title: 'Child A',
          directory: '/repo/active/packages/a',
          updated: '250',
          parentId: 'active-root',
        },
        {
          id: 'child-b',
          directory: '/repo/active/packages/b',
          created: 240,
          parentID: 'child-a',
        },
        {
          id: 'orphan-child',
          title: 'Orphan child',
          directory: '/repo/orphan',
          updated: 350,
          parentId: 'missing-root',
        },
        {
          id: 'older-orphan-child',
          directory: '/repo/orphan/older',
          created: '300',
          parentID: 'missing-root',
        },
        {
          title: 'missing-id row',
        },
        'ignored-string-row',
      ]),
    );

    expect(sessions.map((session) => session.id)).toEqual([
      'inactive-root',
      'active-root',
      'child-a',
      'child-b',
      'orphan-child',
      'older-orphan-child',
    ]);

    const snapshots = buildOpenCodeRootSnapshots({
      sessions,
      activeRootSessionIds: new Set(['active-root', 'missing-root']),
      now: 400,
    });

    expect(snapshots).toHaveLength(2);

    const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.rootSessionId, snapshot]));

    expect(snapshotsById.get('active-root')).toEqual({
      rootSessionId: 'active-root',
      officeId: 'opencode:root:active-root',
      storageId: expect.stringMatching(/^opencode-root-[0-9a-f]{16}$/),
      title: 'Active root',
      directory: '/repo/active',
      updatedAt: 250,
      persistenceMode: 'persistent',
      childSessions: [
        {
          sessionId: 'child-a',
          rootSessionId: 'active-root',
          parentSessionId: 'active-root',
          title: 'Child A',
          directory: '/repo/active/packages/a',
          updatedAt: 250,
        },
        {
          sessionId: 'child-b',
          rootSessionId: 'active-root',
          parentSessionId: 'child-a',
          title: '',
          directory: '/repo/active/packages/b',
          updatedAt: 240,
        },
      ],
    });

    expect(snapshotsById.get('missing-root')).toEqual({
      rootSessionId: 'missing-root',
      officeId: 'opencode:root:missing-root',
      storageId: expect.stringMatching(/^opencode-root-[0-9a-f]{16}$/),
      title: 'Orphan child',
      directory: '/repo/orphan',
      updatedAt: 350,
      persistenceMode: 'ephemeral',
      childSessions: [
        {
          sessionId: 'orphan-child',
          rootSessionId: 'missing-root',
          parentSessionId: 'missing-root',
          title: 'Orphan child',
          directory: '/repo/orphan',
          updatedAt: 350,
        },
        {
          sessionId: 'older-orphan-child',
          rootSessionId: 'missing-root',
          parentSessionId: 'missing-root',
          title: '',
          directory: '/repo/orphan/older',
          updatedAt: 300,
        },
      ],
    });
  });

  it('only corroborates active roots when injected local runtime command lines match known sessions', async () => {
    const probeModulePromise = import('../../src/opencode/openCodeProcessProbe.js');

    await expect(probeModulePromise).resolves.toBeTruthy();

    const { probeOpenCodeProcesses } = await probeModulePromise;
    const probeSessionList = vi.fn().mockResolvedValue([
      {
        id: 'root-a',
      },
      {
        id: 'child-a',
        parentId: 'root-a',
      },
      {
        id: 'root-b',
      },
      {
        id: 'child-b',
        parentID: 'root-b',
      },
    ]);
    const probeRuntimeProcesses = vi.fn().mockResolvedValue([
      {
        pid: 101,
        commandLine: 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd run --session child-a',
      },
      {
        pid: 202,
        commandLine: 'node unrelated-service.js --session root-b-mismatch',
      },
    ]);

    const probe = await probeOpenCodeProcesses(probeSessionList, probeRuntimeProcesses);

    expect(probe.activeRootSessionIds).toBeInstanceOf(Set);
    expect([...probe.activeRootSessionIds]).toEqual(['root-a']);
    expect(probeSessionList).toHaveBeenCalledTimes(1);
    expect(probeRuntimeProcesses).toHaveBeenCalledTimes(1);
  });

  it('returns no active roots when session history exists without matching local runtime corroboration', async () => {
    const probeModulePromise = import('../../src/opencode/openCodeProcessProbe.js');

    await expect(probeModulePromise).resolves.toBeTruthy();

    const { probeOpenCodeProcesses } = await probeModulePromise;
    const probeSessionList = vi.fn().mockResolvedValue([
      {
        id: 'root-a',
      },
      {
        id: 'child-a',
        parentId: 'root-a',
      },
    ]);
    const probeRuntimeProcesses = vi.fn().mockResolvedValue([
      {
        pid: 303,
        commandLine: 'powershell.exe -File watcher.ps1 --session different-root',
      },
    ]);

    const probe = await probeOpenCodeProcesses(probeSessionList, probeRuntimeProcesses);

    expect([...probe.activeRootSessionIds]).toEqual([]);
    expect(probeSessionList).toHaveBeenCalledTimes(1);
    expect(probeRuntimeProcesses).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated processes that mention a known session id outside an OpenCode command', async () => {
    const probeModulePromise = import('../../src/opencode/openCodeProcessProbe.js');

    await expect(probeModulePromise).resolves.toBeTruthy();

    const { probeOpenCodeProcesses } = await probeModulePromise;
    const probeSessionList = vi.fn().mockResolvedValue([
      {
        id: 'root-a',
      },
      {
        id: 'child-a',
        parentId: 'root-a',
      },
    ]);
    const probeRuntimeProcesses = vi.fn().mockResolvedValue([
      {
        pid: 404,
        commandLine: 'node watcher.js --log-tag child-a',
      },
    ]);

    const probe = await probeOpenCodeProcesses(probeSessionList, probeRuntimeProcesses);

    expect([...probe.activeRootSessionIds]).toEqual([]);
    expect(probeSessionList).toHaveBeenCalledTimes(1);
    expect(probeRuntimeProcesses).toHaveBeenCalledTimes(1);
  });
});
