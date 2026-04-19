import type { ToolActivity } from '../office/types.js';

export type OfficeStatus = 'active' | 'stale' | 'detached';

export type OfficePersistenceMode = 'persistent' | 'ephemeral';

export interface OfficeDescriptor {
  officeId: string;
  storageId: string;
  providerId: string;
  rootSessionId: string;
  title: string;
  directory: string;
  status: OfficeStatus;
  lastSeenAt: number;
  persistenceMode: OfficePersistenceMode;
}

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

export interface OfficeBucketState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
}

export interface OfficeOption {
  officeId: string;
  label: string;
  isDefault: boolean;
}
