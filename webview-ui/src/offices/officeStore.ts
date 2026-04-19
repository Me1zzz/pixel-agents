import type { OfficeBucketState, OfficeDescriptor, OfficeOption } from './officeTypes.js';

export const DEFAULT_OFFICE_ID = 'claude:default';

const DEFAULT_OFFICE_DESCRIPTOR: OfficeDescriptor = {
  officeId: DEFAULT_OFFICE_ID,
  storageId: DEFAULT_OFFICE_ID,
  providerId: 'claude',
  rootSessionId: DEFAULT_OFFICE_ID,
  title: 'Claude',
  directory: '',
  status: 'active',
  lastSeenAt: 0,
  persistenceMode: 'persistent',
};

export function resolveOfficeId(officeId?: string): string {
  return officeId && officeId.length > 0 ? officeId : DEFAULT_OFFICE_ID;
}

export function createEmptyOfficeBucket(): OfficeBucketState {
  return {
    agents: [],
    selectedAgent: null,
    agentTools: {},
    agentStatuses: {},
    subagentTools: {},
    subagentCharacters: [],
    layoutReady: false,
    layoutWasReset: false,
  };
}

export function createOfficeBuckets(): Record<string, OfficeBucketState> {
  return { [DEFAULT_OFFICE_ID]: createEmptyOfficeBucket() };
}

export function getBucket(
  buckets: Record<string, OfficeBucketState>,
  officeId: string | undefined,
  createBucket: () => OfficeBucketState,
): OfficeBucketState {
  const resolvedOfficeId = resolveOfficeId(officeId);
  return buckets[resolvedOfficeId] ?? createBucket();
}

export function mergeOfficeCatalog(offices: OfficeDescriptor[]): OfficeDescriptor[] {
  const byId = new Map<string, OfficeDescriptor>();
  byId.set(DEFAULT_OFFICE_ID, DEFAULT_OFFICE_DESCRIPTOR);
  for (const office of offices) {
    byId.set(office.officeId, office);
  }

  const [, ...dynamicOffices] = [...byId.values()];
  dynamicOffices.sort((left, right) => left.title.localeCompare(right.title));
  return [DEFAULT_OFFICE_DESCRIPTOR, ...dynamicOffices];
}

export function listOfficeOptions(offices: OfficeDescriptor[]): OfficeOption[] {
  return offices.map((office) => ({
    officeId: office.officeId,
    label: office.officeId === DEFAULT_OFFICE_ID ? 'Claude' : office.title,
    isDefault: office.officeId === DEFAULT_OFFICE_ID,
  }));
}
