export interface OpenCodeCliSession {
  id: string;
  title?: string;
  directory?: string;
  updated?: number | string;
  created?: number | string;
  parentId?: string | null;
  parentID?: string | null;
}

export interface OpenCodeChildSnapshot {
  sessionId: string;
  rootSessionId: string;
  parentSessionId: string;
  title: string;
  directory: string;
  updatedAt: number;
}

export interface OpenCodeRootSnapshot {
  rootSessionId: string;
  officeId: string;
  storageId: string;
  title: string;
  directory: string;
  updatedAt: number;
  childSessions: OpenCodeChildSnapshot[];
  persistenceMode: 'persistent' | 'ephemeral';
}
