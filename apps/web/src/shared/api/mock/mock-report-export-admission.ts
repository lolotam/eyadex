import { effectiveClinicStatus, NO_FEATURES } from "@eyadex/contracts/clinics";
import { reportPermissionScope } from "@eyadex/contracts/finance-report-access";
import {
  reportExportRequestSchema,
  reportExportResponseSchema,
  type FrozenReportExportParams,
  type ReportExportRequest,
} from "@eyadex/contracts/finance-reports";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";
import { ApiError } from "../api-error";
import { effectivePermissions, memberBranchScope, resolveActor } from "./mock-actor";
import {
  exportJobsOf,
  insertExportJob,
  publicExportOf,
  type ExportJobRecord,
} from "./mock-report-export-state";
import { newId, type MockState } from "./mock-store";

// The API's export admission (report-exports.ts, report-export-admission.ts), in its order: the
// guard (active user → clinic access → finance) → the schema (a range over 1096 days is
// `report_range_too_long`) → the report scope and its covering keys → the frozen branch reach →
// the queue check and the insert, with no await between them.

export const EXPORT_QUEUE_LIMIT = 10;

const GROUP_DEFAULTS = { daily_takings: "day", period_summary: "month" } as const;

/** The API's `parseReportExportRequest`: a too-long range is its own code, anything else `validation`. */
function parseRequest(input: unknown): ReportExportRequest {
  const parsed = reportExportRequestSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  if (parsed.error.issues.some((issue) => issue.message === "validation.rangeTooLong")) {
    throw new ApiError("report_range_too_long");
  }
  throw new ApiError("validation");
}

/**
 * Admits one export request against the injected clock and returns the strict 202 envelope.
 * Synchronous on purpose: the queue check and the insert are one step, so two concurrent callers
 * cannot both pass the cap. Admission writes no audit row and starts no work.
 */
export function admitReportExport(
  db: MockState,
  persona: Persona,
  input: unknown,
  now: Date,
): z.infer<typeof reportExportResponseSchema> {
  const actor = resolveActor(db, persona);
  const status = effectiveClinicStatus(actor.clinic, now.getTime());
  if (status === "suspended" || status === "expired") throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? NO_FEATURES).finance) throw new ApiError("module_disabled");
  const request = parseRequest(input);
  const keys = effectivePermissions(db, actor);
  const scope = reportPermissionScope(keys, request.report);
  if (scope === null) throw new ApiError("forbidden");
  const clinicBranchIds = db.branches
    .filter((branch) => branch.clinicId === actor.clinic.id)
    .map((branch) => branch.id);
  const branches = memberBranchScope(db, actor.member);
  const reach =
    scope === "branch" && !branches.allBranches
      ? clinicBranchIds.filter((id) => branches.branchIds.includes(id))
      : clinicBranchIds;
  if (request.branchId !== undefined && !reach.includes(request.branchId)) {
    throw new ApiError("forbidden");
  }
  const frozen = request.branchId === undefined ? [...reach] : [request.branchId];
  const groupBy =
    request.report === "daily_takings" || request.report === "period_summary"
      ? (request.groupBy ?? GROUP_DEFAULTS[request.report])
      : undefined;
  const params: FrozenReportExportParams = {
    from: request.from,
    to: request.to,
    language: request.language,
    branchIds: frozen,
    ...(groupBy === undefined ? {} : { groupBy }),
  };
  const jobs = exportJobsOf(db);
  const runningForMember = jobs.some(
    (job) =>
      job.clinicId === actor.clinic.id &&
      job.requestedBy === actor.member.id &&
      job.status === "running",
  );
  const queuedCount = jobs.filter(
    (job) => job.clinicId === actor.clinic.id && job.status === "queued",
  ).length;
  if (runningForMember || queuedCount >= EXPORT_QUEUE_LIMIT) throw new ApiError("export_busy");
  const job: ExportJobRecord = {
    id: newId(),
    clinicId: actor.clinic.id,
    requestedBy: actor.member.id,
    report: request.report,
    format: request.format,
    scope,
    params,
    status: "queued",
    createdAt: now.toISOString(),
    expiresAt: null,
    byteSize: null,
    rowCount: null,
    artifact: null,
    ownPatientIds: null,
  };
  insertExportJob(db, job);
  return reportExportResponseSchema.parse({ export: publicExportOf(job) });
}
