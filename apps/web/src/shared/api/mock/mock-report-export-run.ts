import { reportExportAuditDetailsSchema } from "@eyadex/contracts/finance-reports";
import { writeClinicAudit } from "./mock-audit";
import { writeReportCsv } from "./mock-export-csv";
import { writeReportXlsx } from "./mock-export-xlsx";
import { isOwnPatient } from "./mock-own-scope";
import { recheckExportAccess } from "./mock-report-export-access";
import { readReportExport } from "./mock-report-export-read";
import { exportJobsOf, type ExportJobRecord } from "./mock-report-export-state";
import type { MockState } from "./mock-store";

export const EXPORT_STEP_MS = 1000;
export const EXPORT_LIFETIME_MS = 24 * 60 * 60 * 1000;

// Scheduling and coalescing are private and ephemeral, just like the job/byte store. Neither is
// persisted with audit data. A poll claims one phase only, even if its clock jumped ahead.
const claimedAt = new WeakMap<ExportJobRecord, number>();
const inFlight = new WeakMap<ExportJobRecord, Promise<void>>();

function fail(job: ExportJobRecord): void {
  job.status = "failed";
  job.artifact = null;
  job.ownPatientIds = null;
  job.byteSize = null;
  job.rowCount = null;
  job.expiresAt = null;
}

function ownsContributions(
  db: MockState,
  job: ExportJobRecord,
  ids: readonly string[] | null,
): boolean {
  return (
    job.scope !== "own" ||
    (ids !== null && ids.every((id) => isOwnPatient(db, job.clinicId, job.requestedBy, id)))
  );
}

async function build(db: MockState, job: ExportJobRecord, clock: () => Date): Promise<void> {
  try {
    const readClock = clock();
    const access = recheckExportAccess(db, job, readClock);
    if (access.kind !== "ready") return fail(job);
    const data = readReportExport(access.ctx, job.report, job.params, readClock);
    const input = { report: job.report, language: job.params.language, rows: data.rows };
    // CSV also crosses the common await boundary. XLSX performs the real asynchronous ZIP write.
    const result = await (job.format === "csv" ? writeReportCsv(input) : writeReportXlsx(input));
    if (!result.ok) return fail(job);
    // A ready reader context grants nothing across writing: both keys and the exact contributing
    // own set must still be valid. Empty own exports have a complete, valid empty set.
    const postWriteAccess = recheckExportAccess(db, job, clock());
    if (postWriteAccess.kind !== "ready" || !ownsContributions(db, job, data.ownPatientIds))
      return fail(job);
    const details = reportExportAuditDetailsSchema.parse({
      report: job.report,
      from: job.params.from,
      to: job.params.to,
      branchIds: job.params.branchIds.map((id) => id.toLowerCase()),
      rowCount: result.rowCount,
    });
    const finish = clock();
    const publicationAccess = recheckExportAccess(db, job, finish);
    if (publicationAccess.kind !== "ready" || !ownsContributions(db, job, data.ownPatientIds))
      return fail(job);
    const expiresAt = new Date(finish.getTime() + EXPORT_LIFETIME_MS).toISOString();
    // No await from the final live checks through this sole audit writer and publication. A
    // rejected audit inserts nothing and the catch leaves no bytes or successful terminal row.
    writeClinicAudit(
      db,
      {
        clinicId: job.clinicId,
        actorName: publicationAccess.ctx.access.actorName,
        action: "finance_report.exported",
        entity: "finance_report_export",
        entityId: job.id,
        before: null,
        after: details,
        exact: true,
      },
      finish,
    );
    job.artifact = result.bytes;
    job.ownPatientIds = data.ownPatientIds;
    job.rowCount = result.rowCount;
    job.byteSize = result.bytes.byteLength;
    job.expiresAt = expiresAt;
    job.status = "done";
  } catch {
    // Reader exceptions and internal writer refusals never become public ApiError fields.
    fail(job);
  }
}

/** Internal progression only; requester-facing status/list/download are separate increments. */
export async function advanceReportExport(
  db: MockState,
  job: ExportJobRecord,
  clock: () => Date,
): Promise<void> {
  if (!exportJobsOf(db).includes(job)) return;
  const now = clock();
  if (job.status === "done" || job.status === "purged") {
    if (job.expiresAt !== null && now.getTime() >= Date.parse(job.expiresAt)) {
      if (job.status === "done") job.status = "expired";
      job.artifact = null;
      job.ownPatientIds = null;
    }
    return;
  }
  if (job.status === "queued") {
    if (now.getTime() < Date.parse(job.createdAt) + EXPORT_STEP_MS) return;
    if (recheckExportAccess(db, job, now).kind !== "ready") return fail(job);
    claimedAt.set(job, now.getTime());
    job.status = "running";
    return;
  }
  if (job.status !== "running") return;
  const pending = inFlight.get(job);
  if (pending !== undefined) return pending;
  const claim = claimedAt.get(job);
  if (claim === undefined || now.getTime() < claim + EXPORT_STEP_MS) return;
  const work = build(db, job, clock);
  inFlight.set(job, work);
  try {
    await work;
  } finally {
    inFlight.delete(job);
  }
}
