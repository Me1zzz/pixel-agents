import {
  buildOfficeStorageId,
  buildOpenCodeOfficeId,
  canPersistOpenCodeOffice,
} from './openCodeIdentity.js';
import type {
  OpenCodeChildSnapshot,
  OpenCodeCliSession,
  OpenCodeRootSnapshot,
} from './openCodeSessionTypes.js';

const OPENCODE_PROVIDER_ID = 'opencode';

interface BuildOpenCodeRootSnapshotsArgs {
  sessions: OpenCodeCliSession[];
  activeRootSessionIds: Set<string>;
  now: number;
}

interface ParsedSessionRow {
  id: string;
  title?: string;
  directory?: string;
  updated?: number | string;
  created?: number | string;
  parentId?: string | null;
  parentID?: string | null;
}

export function parseOpenCodeSessionList(rawJson: string): OpenCodeCliSession[] {
  const parsed = JSON.parse(rawJson) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((entry) => {
    const session = toOpenCodeCliSession(entry);
    return session ? [session] : [];
  });
}

export function buildOpenCodeRootSnapshots({
  sessions,
  activeRootSessionIds,
  now,
}: BuildOpenCodeRootSnapshotsArgs): OpenCodeRootSnapshot[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const groupedChildren = new Map<string, OpenCodeChildSnapshot[]>();

  for (const session of sessions) {
    const rootSessionId = resolveRootSessionId(session.id, sessionsById, activeRootSessionIds);
    if (!rootSessionId || rootSessionId === session.id) {
      continue;
    }

    const childSnapshot = createChildSnapshot(session, rootSessionId, now);
    const existingChildren = groupedChildren.get(rootSessionId);
    if (existingChildren) {
      existingChildren.push(childSnapshot);
    } else {
      groupedChildren.set(rootSessionId, [childSnapshot]);
    }
  }

  const snapshots: OpenCodeRootSnapshot[] = [];

  for (const rootSessionId of activeRootSessionIds) {
    const rootSession = sessionsById.get(rootSessionId);
    const childSessions = [...(groupedChildren.get(rootSessionId) ?? [])].sort(
      compareByUpdatedDesc,
    );

    if (!rootSession && childSessions.length === 0) {
      continue;
    }

    const rootIdentity = rootSession ? { rootSessionId } : {};
    const persistenceMode = canPersistOpenCodeOffice(rootIdentity) ? 'persistent' : 'ephemeral';
    const fallbackChild = childSessions[0];
    const normalizedRootUpdate = rootSession ? normalizeUpdatedAt(rootSession, now) : 0;

    snapshots.push({
      rootSessionId,
      officeId: buildOpenCodeOfficeId(rootSessionId),
      storageId: buildOfficeStorageId(OPENCODE_PROVIDER_ID, rootSessionId),
      title: rootSession?.title ?? fallbackChild?.title ?? '',
      directory: rootSession?.directory ?? fallbackChild?.directory ?? '',
      updatedAt: Math.max(
        normalizedRootUpdate,
        childSessions[0]?.updatedAt ?? normalizedRootUpdate,
      ),
      childSessions,
      persistenceMode,
    });
  }

  return snapshots.sort(compareByUpdatedDesc);
}

function toOpenCodeCliSession(entry: unknown): OpenCodeCliSession | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const row = entry as ParsedSessionRow;
  if (typeof row.id !== 'string' || row.id.length === 0) {
    return null;
  }

  const session: OpenCodeCliSession = { id: row.id };
  if (typeof row.title === 'string') {
    session.title = row.title;
  }
  if (typeof row.directory === 'string') {
    session.directory = row.directory;
  }
  if (typeof row.updated === 'number' || typeof row.updated === 'string') {
    session.updated = row.updated;
  }
  if (typeof row.created === 'number' || typeof row.created === 'string') {
    session.created = row.created;
  }
  if (typeof row.parentId === 'string' || row.parentId === null) {
    session.parentId = row.parentId;
  }
  if (typeof row.parentID === 'string' || row.parentID === null) {
    session.parentID = row.parentID;
  }

  return session;
}

function resolveRootSessionId(
  sessionId: string,
  sessionsById: Map<string, OpenCodeCliSession>,
  activeRootSessionIds: Set<string>,
): string | null {
  let currentSessionId: string | undefined = sessionId;
  const visited = new Set<string>();

  while (currentSessionId) {
    if (activeRootSessionIds.has(currentSessionId)) {
      return currentSessionId;
    }

    if (visited.has(currentSessionId)) {
      return null;
    }
    visited.add(currentSessionId);

    const currentSession = sessionsById.get(currentSessionId);
    const parentSessionId = getParentSessionId(currentSession);
    if (!parentSessionId) {
      return null;
    }
    currentSessionId = parentSessionId;
  }

  return null;
}

function getParentSessionId(session: OpenCodeCliSession | undefined): string | null {
  if (!session) {
    return null;
  }

  return session.parentId ?? session.parentID ?? null;
}

function createChildSnapshot(
  session: OpenCodeCliSession,
  rootSessionId: string,
  now: number,
): OpenCodeChildSnapshot {
  return {
    sessionId: session.id,
    rootSessionId,
    parentSessionId: getParentSessionId(session) ?? rootSessionId,
    title: session.title ?? '',
    directory: session.directory ?? '',
    updatedAt: normalizeUpdatedAt(session, now),
  };
}

function normalizeUpdatedAt(session: OpenCodeCliSession, now: number): number {
  const updatedAt = normalizeTimestamp(session.updated);
  if (updatedAt !== null) {
    return updatedAt;
  }

  const createdAt = normalizeTimestamp(session.created);
  if (createdAt !== null) {
    return createdAt;
  }

  return now;
}

function normalizeTimestamp(value: number | string | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function compareByUpdatedDesc(left: { updatedAt: number }, right: { updatedAt: number }): number {
  return right.updatedAt - left.updatedAt;
}
