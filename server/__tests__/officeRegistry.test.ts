import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenCodeRootSnapshot } from '../../src/opencode/openCodeSessionTypes.js';

const HOME_PREFIX = 'pixel-agents-office-registry-';

function createSnapshot(overrides: Partial<OpenCodeRootSnapshot> = {}): OpenCodeRootSnapshot {
  return {
    rootSessionId: 'root-1',
    officeId: 'opencode:root:root-1',
    storageId: 'opencode-root-1234567890abcdef',
    title: 'Root One',
    directory: '/workspace/root-one',
    updatedAt: 1_000,
    childSessions: [],
    persistenceMode: 'persistent',
    ...overrides,
  };
}

describe('Office registry and persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reconciles active OpenCode offices, persists office-scoped files, and transitions stale offices deterministically', async () => {
    const registryModulePromise = import('../../src/offices/officeRegistry.js');
    const persistenceModulePromise = import('../../src/offices/officeLayoutPersistence.js');
    const messageRouterModulePromise = import('../../src/offices/officeMessageRouter.js');

    await expect(registryModulePromise).resolves.toBeTruthy();
    await expect(persistenceModulePromise).resolves.toBeTruthy();
    await expect(messageRouterModulePromise).resolves.toBeTruthy();

    const registryModule = await registryModulePromise;
    const persistenceModule = await persistenceModulePromise;
    const messageRouterModule = await messageRouterModulePromise;

    const fakeHome = mkdtempSync(join(tmpdir(), HOME_PREFIX));
    vi.spyOn(process, 'env', 'get').mockReturnValue({
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      HOMEDRIVE: undefined,
      HOMEPATH: undefined,
    });

    try {
      const snapshot = createSnapshot();
      const registry = new registryModule.OfficeRegistry();

      const firstList = registry.reconcile([snapshot], 50_000);
      expect(firstList).toEqual([
        {
          officeId: 'opencode:root:root-1',
          storageId: 'opencode-root-1234567890abcdef',
          providerId: 'opencode',
          rootSessionId: 'root-1',
          title: 'Root One',
          directory: '/workspace/root-one',
          status: 'active',
          lastSeenAt: 50_000,
          persistenceMode: 'persistent',
        },
      ]);
      expect(registry.listOffices()).toEqual(firstList);

      const officeDir = persistenceModule.getOfficeDirectoryPath('opencode-root-1234567890abcdef');
      const layoutFile = persistenceModule.getOfficeLayoutFilePath(
        'opencode-root-1234567890abcdef',
      );
      const metaFile = persistenceModule.getOfficeMetaFilePath('opencode-root-1234567890abcdef');
      expect(officeDir.replace(/\\/g, '/')).toContain(
        '/.pixel-agents/offices/opencode-root-1234567890abcdef',
      );
      expect(layoutFile.replace(/\\/g, '/')).toContain(
        '/.pixel-agents/offices/opencode-root-1234567890abcdef/layout.json',
      );
      expect(metaFile.replace(/\\/g, '/')).toContain(
        '/.pixel-agents/offices/opencode-root-1234567890abcdef/meta.json',
      );

      const layout = { version: 1, cols: 1, rows: 1, tiles: ['floor'] };
      persistenceModule.writeOfficeLayoutToFile('opencode-root-1234567890abcdef', layout);
      expect(persistenceModule.readOfficeLayoutFromFile('opencode-root-1234567890abcdef')).toEqual(
        layout,
      );

      const persistedOffice = registry.listOffices()[0];
      persistenceModule.writeOfficeJson(persistedOffice.storageId, 'meta.json', persistedOffice);
      expect(JSON.parse(readFileSync(metaFile, 'utf8'))).toEqual(persistedOffice);

      expect(registry.reconcile([], 50_000 + 9_999)[0]?.status).toBe('active');
      expect(registry.reconcile([], 50_000 + 10_001)[0]?.status).toBe('stale');
      expect(registry.reconcile([], 50_000 + 310_000)[0]?.status).toBe('stale');
      expect(registry.reconcile([], 50_000 + 310_001)[0]?.status).toBe('detached');

      const refreshed = registry.reconcile(
        [createSnapshot({ title: 'Root One Reloaded', directory: '/workspace/root-one-next' })],
        70_000,
      );
      expect(refreshed).toEqual([
        {
          officeId: 'opencode:root:root-1',
          storageId: 'opencode-root-1234567890abcdef',
          providerId: 'opencode',
          rootSessionId: 'root-1',
          title: 'Root One Reloaded',
          directory: '/workspace/root-one-next',
          status: 'active',
          lastSeenAt: 70_000,
          persistenceMode: 'persistent',
        },
      ]);

      registry.reconcile(
        [
          createSnapshot({
            rootSessionId: 'root-2',
            officeId: 'opencode:root:root-2',
            storageId: 'opencode-root-fedcba0987654321',
            title: 'Alpha Office',
            directory: '/workspace/alpha',
          }),
          createSnapshot({
            rootSessionId: 'root-3',
            officeId: 'opencode:root:root-3',
            storageId: 'opencode-root-1111222233334444',
            title: 'Beta Office',
            directory: '/workspace/beta',
          }),
        ],
        80_000,
      );
      expect(registry.listOffices().map((office) => office.officeId)).toEqual([
        'opencode:root:root-1',
        'opencode:root:root-2',
        'opencode:root:root-3',
      ]);

      const messages: unknown[] = [];
      const webview = {
        postMessage(message: unknown): void {
          messages.push(message);
        },
      };

      messageRouterModule.postOfficesLoaded(webview, registry.listOffices());
      messageRouterModule.postOfficeScoped(webview, 'opencode:root:root-2', {
        type: 'layoutLoaded',
        layout,
      });
      messageRouterModule.postOfficeScoped(webview, 'claude:default', {
        type: 'layoutLoaded',
        layout: { version: 1 },
      });

      expect(messages).toEqual([
        {
          type: 'officesLoaded',
          offices: registry.listOffices(),
        },
        {
          type: 'layoutLoaded',
          officeId: 'opencode:root:root-2',
          layout,
        },
        {
          type: 'layoutLoaded',
          layout: { version: 1 },
        },
      ]);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
