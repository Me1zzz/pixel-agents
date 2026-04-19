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
