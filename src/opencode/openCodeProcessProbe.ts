import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseOpenCodeSessionList } from './openCodeDiscovery.js';
import type { OpenCodeCliSession } from './openCodeSessionTypes.js';

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';

export interface OpenCodeProcessProbe {
  activeRootSessionIds: Set<string>;
}

type OpenCodeSessionListProbe = () => Promise<OpenCodeCliSession[]>;
type OpenCodeRuntimeProcessProbe = () => Promise<OpenCodeRuntimeProcess[]>;

interface OpenCodeRuntimeProcess {
  pid: number;
  commandLine: string;
}

interface ParsedWindowsProcessRow {
  ProcessId?: number;
  CommandLine?: string | null;
}

export async function probeOpenCodeProcesses(
  loadSessions: OpenCodeSessionListProbe = probeOpenCodeSessionList,
  loadRuntimeProcesses: OpenCodeRuntimeProcessProbe = probeOpenCodeRuntimeProcesses,
): Promise<OpenCodeProcessProbe> {
  const [sessions, runtimeProcesses] = await Promise.all([loadSessions(), loadRuntimeProcesses()]);
  const activeRootSessionIds = new Set<string>();
  const rootSessionIdsBySessionId = buildRootSessionIdsBySessionId(sessions);

  for (const runtimeProcess of runtimeProcesses) {
    const matchedRootSessionId = findRootSessionIdInCommandLine(
      runtimeProcess.commandLine,
      rootSessionIdsBySessionId,
    );
    if (matchedRootSessionId) {
      activeRootSessionIds.add(matchedRootSessionId);
    }
  }

  return { activeRootSessionIds };
}

export async function probeOpenCodeSessionList(): Promise<OpenCodeCliSession[]> {
  try {
    const command = IS_WINDOWS ? 'cmd' : 'opencode';
    const args = IS_WINDOWS
      ? ['/c', 'opencode', 'session', 'list', '--format', 'json']
      : ['session', 'list', '--format', 'json'];
    const { stdout } = await execFileAsync(command, args, { windowsHide: true });
    return parseOpenCodeSessionList(stdout);
  } catch (err) {
    console.warn('[Pixel Agents] Failed to list OpenCode sessions:', err);
    return [];
  }
}

async function probeOpenCodeRuntimeProcesses(): Promise<OpenCodeRuntimeProcess[]> {
  try {
    if (IS_WINDOWS) {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
        ],
        { windowsHide: true },
      );
      return parseWindowsRuntimeProcesses(stdout);
    }

    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command=']);
    return parsePosixRuntimeProcesses(stdout);
  } catch (err) {
    console.warn('[Pixel Agents] Failed to inspect OpenCode runtime processes:', err);
    return [];
  }
}

function getParentSessionId(session: OpenCodeCliSession): string | null {
  return session.parentId ?? session.parentID ?? null;
}

function buildRootSessionIdsBySessionId(sessions: OpenCodeCliSession[]): Map<string, string> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const rootSessionIdsBySessionId = new Map<string, string>();

  for (const session of sessions) {
    const rootSessionId = resolveRootSessionId(session, sessionsById);
    if (rootSessionId) {
      rootSessionIdsBySessionId.set(session.id, rootSessionId);
    }
  }

  return rootSessionIdsBySessionId;
}

function resolveRootSessionId(
  session: OpenCodeCliSession,
  sessionsById: Map<string, OpenCodeCliSession>,
): string | null {
  let currentSession: OpenCodeCliSession | undefined = session;
  const visited = new Set<string>();

  while (currentSession) {
    if (visited.has(currentSession.id)) {
      return null;
    }
    visited.add(currentSession.id);

    const parentSessionId = getParentSessionId(currentSession);
    if (!parentSessionId) {
      return currentSession.id;
    }

    const parentSession = sessionsById.get(parentSessionId);
    if (!parentSession) {
      return parentSessionId;
    }

    currentSession = parentSession;
  }

  return null;
}

function findRootSessionIdInCommandLine(
  commandLine: string,
  rootSessionIdsBySessionId: Map<string, string>,
): string | null {
  if (!looksLikeOpenCodeCommand(commandLine)) {
    return null;
  }

  for (const [sessionId, rootSessionId] of getSortedSessionMatches(rootSessionIdsBySessionId)) {
    if (buildSessionIdPattern(sessionId).test(commandLine)) {
      return rootSessionId;
    }
  }

  return null;
}

function getSortedSessionMatches(
  rootSessionIdsBySessionId: Map<string, string>,
): Array<[sessionId: string, rootSessionId: string]> {
  return [...rootSessionIdsBySessionId.entries()].sort(
    (left, right) => right[0].length - left[0].length,
  );
}

function looksLikeOpenCodeCommand(commandLine: string): boolean {
  return /(^|[\\/\s"'])opencode(?:\.cmd|\.exe)?(?=$|[\s"'])/iu.test(commandLine);
}

function buildSessionIdPattern(sessionId: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(sessionId)}(?:$|[^A-Za-z0-9_-])`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseWindowsRuntimeProcesses(rawJson: string): OpenCodeRuntimeProcess[] {
  const normalized = rawJson.trim();
  if (normalized.length === 0) {
    return [];
  }

  const parsed = JSON.parse(normalized) as ParsedWindowsProcessRow | ParsedWindowsProcessRow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.flatMap((row) => {
    if (typeof row.ProcessId !== 'number' || typeof row.CommandLine !== 'string') {
      return [];
    }

    return [
      {
        pid: row.ProcessId,
        commandLine: row.CommandLine,
      },
    ];
  });
}

function parsePosixRuntimeProcesses(stdout: string): OpenCodeRuntimeProcess[] {
  return stdout.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/u);
    if (!match) {
      return [];
    }

    const pid = Number(match[1]);
    const commandLine = match[2]?.trim();
    if (!Number.isFinite(pid) || !commandLine) {
      return [];
    }

    return [
      {
        pid,
        commandLine,
      },
    ];
  });
}
