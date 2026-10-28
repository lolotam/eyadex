import { effectiveClinicStatus, NO_FEATURES } from "@eyadex/contracts/clinics";
import { idSchema } from "@eyadex/contracts/common";
import {
  reportExportListQuerySchema,
  reportExportListResponseSchema,
  reportExportResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { ReportExportsApi } from "../reports-client";
import { resolveActor, type Actor } from "./mock-actor";
import { isOwnPatient } from "./mock-own-scope";
import { admitReportExport } from "./mock-report-export-admission";
import { recheckExportAccess } from "./mock-report-export-access";
import { advanceReportExport } from "./mock-report-export-run";
import { exportJobsOf, publicExportOf, type ExportJobRecord } from "./mock-report-export-state";
import { getState, persist, type MockState } from "./mock-store";

function currentActor(db: MockState, persona: Persona, now: Date): Actor {
  // resolveActor's general guard predates late-download role handling; keep that guard unchanged.
  if (persona.memberId) {
    const member = db.members.find(
      (m) => m.clinicId === persona.clinicId && m.id === persona.memberId,
    );
    if (member && !db.roles.some((r) => r.clinicId === member.clinicId && r.id === member.roleId))
      throw new ApiError("account_disabled");
  }
  const actor = resolveActor(db, persona);
  if (!actor.role.isActive) throw new ApiError("account_disabled");
  const status = effectiveClinicStatus(actor.clinic, now.getTime());
  if (status === "suspended" || status === "expired") throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? NO_FEATURES).finance) throw new ApiError("module_disabled");
  return actor;
}

function requesterJobs(db: MockState, actor: Actor): ExportJobRecord[] {
  return exportJobsOf(db).filter(
    (job) => job.clinicId === actor.clinic.id && job.requestedBy === actor.member.id,
  );
}

function requesterJob(db: MockState, actor: Actor, input: string): ExportJobRecord {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) throw new ApiError("not_found");
  const job = requesterJobs(db, actor).find(
    (row) => row.id.toLowerCase() === parsed.data.toLowerCase(),
  );
  if (!job) throw new ApiError("not_found");
  return job;
}

const newest = (a: ExportJobRecord, b: ExportJobRecord): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.toLowerCase().localeCompare(a.id.toLowerCase());

function downloadAccess(db: MockState, job: ExportJobRecord, now: Date): Uint8Array {
  if (
    job.status !== "done" ||
    job.expiresAt === null ||
    now.getTime() >= Date.parse(job.expiresAt) ||
    job.artifact === null ||
    job.artifact.byteLength === 0
  )
    throw new ApiError("not_found");
  const access = recheckExportAccess(db, job, now);
  if (access.kind !== "ready") throw new ApiError(access.code);
  if (job.scope === "own") {
    if (job.ownPatientIds === null) throw new ApiError("not_found");
    if (job.ownPatientIds.some((id) => !isOwnPatient(db, job.clinicId, job.requestedBy, id))) {
      // Keep the exact ledger and original expiry so later reach cannot resurrect the file.
      job.artifact = null;
      job.status = "purged";
      throw new ApiError("not_found");
    }
  }
  return job.artifact;
}

/** Standalone requester surface. Factories deliberately do not wire it until the integration slice. */
export function createMockReportExports(clock: () => Date = () => new Date()): ReportExportsApi {
  function stateClock(db: MockState): Date {
    const now = clock();
    if (getState() !== db) throw new ApiError("not_found");
    return now;
  }

  async function advance(db: MockState, jobs: ExportJobRecord[]): Promise<void> {
    const before = db.clinicAudit.length;
    await Promise.all(jobs.map((job) => advanceReportExport(db, job, () => stateClock(db))));
    // The ordinary audit persistence path serializes only MockState, never private job memory.
    if (getState() !== db) throw new ApiError("not_found");
    if (db.clinicAudit.length !== before) persist();
  }

  function actorAfter(db: MockState, persona: Persona, original: Actor): Actor {
    const actor = currentActor(db, persona, stateClock(db));
    if (actor.clinic.id !== original.clinic.id || actor.member.id !== original.member.id)
      throw new ApiError("not_found");
    return actor;
  }

  return {
    async requestExport(persona, body) {
      const db = getState();
      return admitReportExport(db, persona, body, stateClock(db));
    },
    async getExport(persona, exportId) {
      const db = getState();
      const actor = currentActor(db, persona, stateClock(db));
      const job = requesterJob(db, actor, exportId);
      await advance(db, [job]);
      const live = actorAfter(db, persona, actor);
      return reportExportResponseSchema.parse({
        export: publicExportOf(requesterJob(db, live, job.id)),
      });
    },
    async listExports(persona, input) {
      const db = getState();
      const actor = currentActor(db, persona, stateClock(db));
      const parsed = reportExportListQuerySchema.safeParse(input);
      if (!parsed.success) throw new ApiError("validation");
      await advance(db, requesterJobs(db, actor));
      const live = actorAfter(db, persona, actor);
      const rows = requesterJobs(db, live).sort(newest);
      const { cursor, limit } = parsed.data;
      const anchor =
        cursor === undefined
          ? undefined
          : rows.find((row) => row.id.toLowerCase() === cursor.toLowerCase());
      const remaining =
        cursor === undefined
          ? rows
          : anchor === undefined
            ? []
            : rows.filter((row) => newest(row, anchor) > 0);
      const page = remaining.slice(0, limit);
      return reportExportListResponseSchema.parse({
        items: page.map(publicExportOf),
        nextCursor: remaining.length > limit ? (page.at(-1)?.id ?? null) : null,
        total: rows.length,
      });
    },
    async downloadExport(persona, exportId) {
      const db = getState();
      const actor = currentActor(db, persona, stateClock(db));
      const job = requesterJob(db, actor, exportId);
      // A download cleans due terminal expiry, but never claims or builds unfinished work.
      if (job.status === "done" || job.status === "purged")
        await advanceReportExport(db, job, () => stateClock(db));
      actorAfter(db, persona, actor);
      const bytes = downloadAccess(db, job, stateClock(db));
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], {
        type:
          job.format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      // Real byte-copy/Blob preparation crosses an await; a prior grant cannot authorize return.
      await Promise.resolve(blob);
      actorAfter(db, persona, actor);
      await advanceReportExport(db, job, () => stateClock(db));
      const current = downloadAccess(db, job, stateClock(db));
      if (current !== bytes || requesterJob(db, actor, job.id) !== job)
        throw new ApiError("not_found");
      return blob;
    },
  };
}
