import { OPENCODE_DETACHED_TTL_MS, OPENCODE_STALE_GRACE_MS } from '../constants.js';
import type { OpenCodeRootSnapshot } from '../opencode/openCodeSessionTypes.js';
import type { OfficeDescriptor, OfficeStatus } from './officeTypes.js';

const OPENCODE_PROVIDER_ID = 'opencode';

export class OfficeRegistry {
  private readonly offices = new Map<string, OfficeDescriptor>();

  reconcile(snapshots: OpenCodeRootSnapshot[], now: number): OfficeDescriptor[] {
    const activeOfficeIds = new Set<string>();

    for (const snapshot of snapshots) {
      activeOfficeIds.add(snapshot.officeId);
      const existing = this.offices.get(snapshot.officeId);

      this.offices.set(snapshot.officeId, {
        officeId: snapshot.officeId,
        storageId: snapshot.storageId,
        providerId: OPENCODE_PROVIDER_ID,
        rootSessionId: snapshot.rootSessionId,
        title: snapshot.title,
        directory: snapshot.directory,
        status: 'active',
        lastSeenAt: now,
        persistenceMode: snapshot.persistenceMode,
        ...(existing ? {} : null),
      });
    }

    for (const office of this.offices.values()) {
      if (activeOfficeIds.has(office.officeId)) {
        continue;
      }

      office.status = getOfficeStatus(now - office.lastSeenAt);
    }

    return this.listOffices();
  }

  listOffices(): OfficeDescriptor[] {
    return [...this.offices.values()].sort(compareOffices).map((office) => ({ ...office }));
  }
}

function getOfficeStatus(sinceLastSeenMs: number): OfficeStatus {
  if (sinceLastSeenMs > OPENCODE_STALE_GRACE_MS + OPENCODE_DETACHED_TTL_MS) {
    return 'detached';
  }

  if (sinceLastSeenMs > OPENCODE_STALE_GRACE_MS) {
    return 'stale';
  }

  return 'active';
}

function compareOffices(left: OfficeDescriptor, right: OfficeDescriptor): number {
  return left.officeId.localeCompare(right.officeId);
}
