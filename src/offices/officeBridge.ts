import { DEFAULT_CLAUDE_OFFICE_ID } from '../constants.js';
import { buildOpenCodeRootSnapshots } from '../opencode/openCodeDiscovery.js';
import type { OpenCodeCliSession } from '../opencode/openCodeSessionTypes.js';
import {
  readOfficeLayoutFromFile,
  readOfficeSeatsFromFile,
  writeOfficeLayoutToFile,
  writeOfficeSeatsToFile,
} from './officeLayoutPersistence.js';
import {
  postOfficeExistingAgents,
  postOfficeLayoutLoaded,
  postOfficesLoaded,
} from './officeMessageRouter.js';
import type { OfficeRegistry } from './officeRegistry.js';
import type { OfficeDescriptor } from './officeTypes.js';

interface MessageTarget {
  postMessage(message: unknown): void;
}

interface OfficeBridgeControllerOptions {
  officeRegistry: Pick<OfficeRegistry, 'listOffices'>;
  postMessage(message: unknown): void;
  writeLegacyLayout(layout: Record<string, unknown>): void;
  markLegacyLayoutOwnWrite(): void;
  readLegacySeats?(): Record<string, unknown>;
  writeLegacySeats?(seats: Record<string, unknown>): void;
}

interface SaveLayoutArgs {
  officeId?: string;
  layout: Record<string, unknown>;
}

interface SaveSeatsArgs {
  officeId?: string;
  seats: Record<string, unknown>;
}

interface RefreshLoopState {
  started: boolean;
}

type PersistenceTarget =
  | {
      officeId: string;
      kind: 'legacy-claude';
    }
  | {
      officeId: string;
      kind: 'office-storage';
      office: OfficeDescriptor;
    }
  | {
      officeId: string;
      kind: 'unknown-office';
    };

export function normalizeOfficeId(officeId?: string): string {
  return officeId && officeId.length > 0 ? officeId : DEFAULT_CLAUDE_OFFICE_ID;
}

export function resolveOfficePersistenceTarget(
  officeId: string | undefined,
  offices: OfficeDescriptor[],
): PersistenceTarget {
  const normalizedOfficeId = normalizeOfficeId(officeId);
  if (normalizedOfficeId === DEFAULT_CLAUDE_OFFICE_ID) {
    return {
      officeId: DEFAULT_CLAUDE_OFFICE_ID,
      kind: 'legacy-claude',
    };
  }

  const office = offices.find((entry) => entry.officeId === normalizedOfficeId);
  if (!office) {
    return {
      officeId: normalizedOfficeId,
      kind: 'unknown-office',
    };
  }

  return {
    officeId: normalizedOfficeId,
    kind: 'office-storage',
    office,
  };
}

export class OfficeBridgeController {
  private readonly officeRegistry: Pick<OfficeRegistry, 'listOffices'>;
  private readonly messageTarget: MessageTarget;
  private readonly writeLegacyLayout: (layout: Record<string, unknown>) => void;
  private readonly markLegacyLayoutOwnWrite: () => void;
  private readonly readLegacySeats: () => Record<string, unknown>;
  private readonly writeLegacySeats: (seats: Record<string, unknown>) => void;
  private refreshLoopState: RefreshLoopState = { started: false };

  constructor(options: OfficeBridgeControllerOptions) {
    this.officeRegistry = options.officeRegistry;
    this.messageTarget = { postMessage: options.postMessage };
    this.writeLegacyLayout = options.writeLegacyLayout;
    this.markLegacyLayoutOwnWrite = options.markLegacyLayoutOwnWrite;
    this.readLegacySeats = options.readLegacySeats ?? (() => ({}));
    this.writeLegacySeats = options.writeLegacySeats ?? (() => undefined);
  }

  postOfficeCatalog(): void {
    postOfficesLoaded(this.messageTarget, this.officeRegistry.listOffices());
  }

  hydrateOpenCodeOffices(defaultLayout: Record<string, unknown> | null): void {
    for (const office of this.officeRegistry.listOffices()) {
      if (office.officeId === DEFAULT_CLAUDE_OFFICE_ID) {
        continue;
      }

      const savedLayout = readOfficeLayoutFromFile(office.storageId);
      postOfficeLayoutLoaded(this.messageTarget, office.officeId, savedLayout ?? defaultLayout);
      postOfficeExistingAgents(this.messageTarget, office.officeId);
    }
  }

  startOpenCodeRefreshLoop(): void {
    this.refreshLoopState = { started: true };
  }

  getRefreshLoopState(): RefreshLoopState {
    return { ...this.refreshLoopState };
  }

  saveLayout(args: SaveLayoutArgs): void {
    const target = resolveOfficePersistenceTarget(args.officeId, this.officeRegistry.listOffices());
    if (target.kind === 'legacy-claude') {
      this.markLegacyLayoutOwnWrite();
      this.writeLegacyLayout(args.layout);
      return;
    }
    if (target.kind === 'unknown-office') {
      return;
    }

    writeOfficeLayoutToFile(target.office.storageId, args.layout);
  }

  saveAgentSeats(args: SaveSeatsArgs): void {
    const target = resolveOfficePersistenceTarget(args.officeId, this.officeRegistry.listOffices());
    if (target.kind === 'legacy-claude') {
      this.writeLegacySeats(args.seats);
      return;
    }
    if (target.kind === 'unknown-office') {
      return;
    }

    writeOfficeSeatsToFile(target.office.storageId, args.seats);
  }

  readAgentSeats(officeId?: string): Record<string, unknown> {
    const target = resolveOfficePersistenceTarget(officeId, this.officeRegistry.listOffices());
    if (target.kind === 'legacy-claude') {
      return this.readLegacySeats();
    }
    if (target.kind === 'unknown-office') {
      return {};
    }

    return readOfficeSeatsFromFile(target.office.storageId);
  }
}

interface ReconcileOpenCodeOfficeCatalogArgs {
  officeRegistry: Pick<OfficeRegistry, 'reconcile'>;
  sessions: OpenCodeCliSession[];
  activeRootSessionIds: Set<string>;
  now: number;
}

export function reconcileOpenCodeOfficeCatalog({
  officeRegistry,
  sessions,
  activeRootSessionIds,
  now,
}: ReconcileOpenCodeOfficeCatalogArgs): void {
  const snapshots = buildOpenCodeRootSnapshots({
    sessions,
    activeRootSessionIds,
    now,
  });
  officeRegistry.reconcile(snapshots, now);
}
