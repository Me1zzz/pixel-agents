import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

function runOpenCodeSessionTypesCheck(): { success: boolean; output: string } {
  const repoRoot = join(__dirname, '..', '..');
  const tempDir = mkdtempSync(join(tmpdir(), 'pixel-agents-opencode-types-'));
  const fixturePath = join(tempDir, 'openCodeSessionTypes.fixture.ts');
  const typesModulePath = join(repoRoot, 'src', 'opencode', 'openCodeSessionTypes.ts');
  let importPath = relative(dirname(fixturePath), typesModulePath)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '');
  if (!importPath.startsWith('.')) {
    importPath = `./${importPath}`;
  }

  writeFileSync(
    fixturePath,
    `import type {
  OpenCodeChildSnapshot,
  OpenCodeCliSession,
  OpenCodeRootSnapshot,
} from '${importPath}';

const cliSession: OpenCodeCliSession = {
  id: 'child-session-456',
  title: 'Child session',
  directory: 'C:/tmp/project',
  updated: 1713524700000,
  created: 1713524600000,
  parentId: 'root-session-123',
  parentID: 'root-session-123',
};

const childSnapshot: OpenCodeChildSnapshot = {
  sessionId: cliSession.id,
  rootSessionId: 'root-session-123',
  parentSessionId: 'root-session-123',
  title: cliSession.title ?? '',
  directory: cliSession.directory ?? '',
  updatedAt: Number(cliSession.updated),
};

const persistentRoot: OpenCodeRootSnapshot = {
  rootSessionId: 'root-session-123',
  officeId: 'opencode:root:root-session-123',
  storageId: 'opencode-root-1234567890abcdef',
  title: 'Root session',
  directory: 'C:/tmp/project',
  updatedAt: 1713524800000,
  childSessions: [childSnapshot],
  persistenceMode: 'persistent',
};

const ephemeralRoot: OpenCodeRootSnapshot = {
  ...persistentRoot,
  persistenceMode: 'ephemeral',
};

void [persistentRoot, ephemeralRoot];
`,
    'utf8',
  );

  try {
    const tscCliPath = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    execFileSync(process.execPath, [
      tscCliPath,
      '--noEmit',
      '--pretty',
      'false',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'node',
      '--strict',
      '--skipLibCheck',
      fixturePath,
    ]);
    return { success: true, output: '' };
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '';
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error && typeof error === 'object' && 'status' in error ? String(error.status ?? '') : '';
    return {
      success: false,
      output: [message, status && `status=${status}`, stdout, stderr].filter(Boolean).join('\n'),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runOpenCodeIdentityContractCheck(): { success: boolean; output: string } {
  const repoRoot = join(__dirname, '..', '..');
  const tempDir = mkdtempSync(join(tmpdir(), 'pixel-agents-opencode-identity-'));
  const fixturePath = join(tempDir, 'openCodeIdentity.fixture.ts');
  const identityModulePath = join(repoRoot, 'src', 'opencode', 'openCodeIdentity.ts');
  let importPath = relative(dirname(fixturePath), identityModulePath)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '');
  if (!importPath.startsWith('.')) {
    importPath = `./${importPath}`;
  }

  writeFileSync(
    fixturePath,
    `import { canPersistOpenCodeOffice } from '${importPath}';

type Assert<T extends true> = T;
type IsExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false;

type ParameterShape = Parameters<typeof canPersistOpenCodeOffice>[0];
type _parameterContract = Assert<IsExact<ParameterShape, { rootSessionId?: string }>>;

const persists = canPersistOpenCodeOffice({ rootSessionId: 'root-session-123' });
const missingRoot = canPersistOpenCodeOffice({});

void [persists, missingRoot];
`,
    'utf8',
  );

  try {
    const tscCliPath = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    execFileSync(process.execPath, [
      tscCliPath,
      '--noEmit',
      '--pretty',
      'false',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'node',
      '--strict',
      '--skipLibCheck',
      fixturePath,
    ]);
    return { success: true, output: '' };
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '';
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error && typeof error === 'object' && 'status' in error ? String(error.status ?? '') : '';
    return {
      success: false,
      output: [message, status && `status=${status}`, stdout, stderr].filter(Boolean).join('\n'),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('OpenCode identity helpers', () => {
  it('exposes the approved Task 1 constants', async () => {
    const constantsModulePromise = import('../../src/constants.js');

    await expect(constantsModulePromise).resolves.toMatchObject({
      DEFAULT_CLAUDE_OFFICE_ID: 'claude:default',
      OFFICE_STORAGE_DIR_NAME: 'offices',
      OFFICE_META_FILE_NAME: 'meta.json',
      OPENCODE_DISCOVERY_INTERVAL_MS: 3000,
      OPENCODE_STALE_GRACE_MS: 10000,
      OPENCODE_DETACHED_TTL_MS: 300000,
    });
  });

  it('typechecks the approved Task 1 session snapshot contracts', async () => {
    const sessionTypesModulePromise = import('../../src/opencode/openCodeSessionTypes.js');

    await expect(sessionTypesModulePromise).resolves.toBeTruthy();

    const typecheckResult = runOpenCodeSessionTypesCheck();
    if (!typecheckResult.success) {
      throw new Error(typecheckResult.output);
    }

    await expect(sessionTypesModulePromise).resolves.toBeTruthy();
  });

  it('typechecks the narrowed root-session persistence helper contract', async () => {
    const identityModulePromise = import('../../src/opencode/openCodeIdentity.js');

    await expect(identityModulePromise).resolves.toBeTruthy();

    const contractCheckResult = runOpenCodeIdentityContractCheck();
    if (!contractCheckResult.success) {
      throw new Error(contractCheckResult.output);
    }
  });

  it('builds deterministic office and storage identifiers', async () => {
    const identityModulePromise = import('../../src/opencode/openCodeIdentity.js');

    await expect(identityModulePromise).resolves.toBeTruthy();

    const identityModule = await identityModulePromise;
    const firstStorageId = identityModule.buildOfficeStorageId('opencode', 'root-session-123');

    expect(identityModule.buildOpenCodeOfficeId('root-session-123')).toBe(
      'opencode:root:root-session-123',
    );
    expect(firstStorageId).toBe(
      identityModule.buildOfficeStorageId('opencode', 'root-session-123'),
    );
    expect(firstStorageId).toMatch(/^opencode-root-[0-9a-f]{16}$/);
    expect(firstStorageId).not.toBe(
      identityModule.buildOfficeStorageId('opencode', 'different-root-session'),
    );
    expect(firstStorageId).not.toBe(
      identityModule.buildOfficeStorageId('different-provider', 'root-session-123'),
    );
  });

  it('persists offices only when a root session id is present', async () => {
    const identityModulePromise = import('../../src/opencode/openCodeIdentity.js');

    await expect(identityModulePromise).resolves.toBeTruthy();

    const identityModule = await identityModulePromise;

    expect(identityModule.canPersistOpenCodeOffice({ rootSessionId: 'root-session-123' })).toBe(
      true,
    );
    expect(identityModule.canPersistOpenCodeOffice({ rootSessionId: '' })).toBe(false);
    expect(identityModule.canPersistOpenCodeOffice({})).toBe(false);
  });
});
