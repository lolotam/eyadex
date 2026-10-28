import {
  reportExportSchema,
  type FrozenReportExportParams,
  type ReportExport,
  type ReportExportFormat,
  type ReportExportStatus,
  type ReportId,
} from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";
import type { MockState } from "./mock-store";

/**
 * An export job as the mock keeps it internally. `artifact` and `ownPatientIds` are reserved for
 * the lifecycle increment; admission never fills them. Neither the params nor the own-patient set
 * ever reach the public projection.
 */
export interface ExportJobRecord {
  readonly id: ReportExportId;
  readonly clinicId: string;
  readonly requestedBy: string;
  readonly report: ReportId;
  readonly format: ReportExportFormat;
  readonly scope: PermissionScope;
  readonly params: FrozenReportExportParams;
  status: ReportExportStatus;
  readonly createdAt: string;
  expiresAt: string | null;
  byteSize: number | null;
  rowCount: number | null;
  artifact: Uint8Array | null;
  ownPatientIds: readonly string[] | null;
}

/**
 * Ephemeral job memory: keyed by the actual state object, never serialized, never in browser
 * storage. A reset or reseed replaces the state key, so old jobs become unreachable.
 */
const jobsByState = new WeakMap<MockState, ExportJobRecord[]>();

/** The clinic's job rows of this state (internal adapter state, not an ApiClient surface). */
export function exportJobsOf(db: MockState): ExportJobRecord[] {
  let jobs = jobsByState.get(db);
  if (!jobs) {
    jobs = [];
    jobsByState.set(db, jobs);
  }
  return jobs;
}

export function insertExportJob(db: MockState, job: ExportJobRecord): void {
  exportJobsOf(db).push(job);
}

/** The public row: exactly the eight contract fields, parsed strict — never scope, params or set. */
export function publicExportOf(job: ExportJobRecord): ReportExport {
  return reportExportSchema.parse({
    id: job.id,
    report: job.report,
    format: job.format,
    status: job.status,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    byteSize: job.byteSize,
    rowCount: job.rowCount,
  });
}
