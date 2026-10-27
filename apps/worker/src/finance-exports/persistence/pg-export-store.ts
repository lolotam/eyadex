import type { Database, IdGenerator } from "@eyadex/db";

import type { ExportFailureKind } from "../domain/export-failures.ts";
import type {
  ClaimDecision,
  ExportFence,
  ExportStore,
  FenceAnswer,
  LeasedExportJob,
  PrepareExportAnswer,
  PublishAnswer,
} from "../ports/export-store.ts";
import { decideExportClaim } from "./pg-export-claim.ts";
import { abandonExport, failExport, heartbeatExport, releaseExport } from "./pg-export-fence.ts";
import { allocateExportBlob, markExportUploaded, publishExport } from "./pg-export-publish.ts";
import { rereadAttempt } from "./export-sql.ts";
import { readLeasedExportJob } from "./pg-export-job.ts";
import { prepareLeasedExportJob } from "./pg-export-prepare.ts";

/**
 * مخزن PostgreSQL للتصدير. كل دخول إنتاجي `withTenant` على `eyadex_app`، من غير عميل خام.
 */
export class PgExportStore implements ExportStore {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  /** @inheritdoc */
  decideClaim(input: {
    clinicId: string;
    exportId: string;
    leaseOwner: string;
  }): Promise<ClaimDecision> {
    return decideExportClaim(this.db, input);
  }

  /** @inheritdoc */
  heartbeat(fence: ExportFence): Promise<FenceAnswer> {
    return heartbeatExport(this.db, fence);
  }

  /** @inheritdoc */
  recordFailure(fence: ExportFence, kind: ExportFailureKind): Promise<FenceAnswer> {
    return failExport(this.db, fence, kind);
  }

  /** @inheritdoc */
  release(fence: ExportFence): Promise<FenceAnswer> {
    return releaseExport(this.db, fence);
  }

  /** @inheritdoc */
  abandon(fence: ExportFence): Promise<FenceAnswer> {
    return abandonExport(this.db, fence);
  }

  /** @inheritdoc */
  allocateBlob(fence: ExportFence) {
    return allocateExportBlob(this.db, this.ids, fence);
  }

  /** @inheritdoc */
  markUploaded(fence: ExportFence) {
    return markExportUploaded(this.db, fence);
  }

  /** @inheritdoc */
  publish(
    fence: ExportFence,
    input: {
      byteSize: number;
      rowCount: number;
      patientIds: readonly string[] | null;
      patientSet?: "ledger" | null;
    },
  ): Promise<PublishAnswer> {
    return publishExport(this.db, this.ids, fence, input);
  }

  /** @inheritdoc */
  reread(fence: ExportFence): Promise<"own_success" | "lost_lease"> {
    return rereadAttempt(this.db, fence);
  }

  /** @inheritdoc */
  readLeasedJob(fence: ExportFence): Promise<LeasedExportJob | null> {
    return readLeasedExportJob(this.db, fence);
  }

  /** @inheritdoc */
  prepareLeasedJob(fence: ExportFence): Promise<PrepareExportAnswer> {
    return prepareLeasedExportJob(this.db, fence);
  }
}
