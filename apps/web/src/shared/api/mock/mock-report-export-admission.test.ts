import { beforeEach, expect, it } from "vitest";
import {
  REPORT_IDS,
  reportExportResponseSchema,
  type ReportId,
} from "@eyadex/contracts/finance-reports";
import { ApiError } from "../api-error";
import {
  admitReportExport,
  EXPORT_QUEUE_LIMIT,
} from "./mock-report-export-admission";
import { exportJobsOf, insertExportJob, type ExportJobRecord } from "./mock-report-export-state";
import { admin, clinicIdAt, getState, personaWith } from "./mock-report-test-kit";
import { resetMockData } from "./mock-test-kit";

const NOW = new Date("2026-10-28T12:00:00.000Z");

const request = (changes: Record<string, unknown> = {}) => ({
  report: "daily_takings",
  from: "2026-01-01",
  to: "2026-12-31",
  format: "csv",
  language: "en",
  ...changes,
});

/** The refusal code of a synchronous admission; a success fails the test. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

const branchesOf = () => getState().branches.filter((b) => b.clinicId === clinicIdAt(0));

function fakeJob(clinicId: string, status: ExportJobRecord["status"], requestedBy = "x") {
  const job: ExportJobRecord = {
    id: crypto.randomUUID(),
    clinicId,
    requestedBy,
    report: "daily_takings",
    format: "csv",
    scope: "clinic",
    params: { from: "2026-01-01", to: "2026-12-31", language: "en", branchIds: [] },
    status,
    createdAt: NOW.toISOString(),
    expiresAt: null,
    byteSize: null,
    rowCount: null,
    artifact: null,
    ownPatientIds: null,
  };
  insertExportJob(getState(), job);
  return job;
}

beforeEach(() => resetMockData());

it("admits a queued job and answers the strict eight-field envelope", () => {
  const response = admitReportExport(getState(), admin(), request(), NOW);
  expect(() => reportExportResponseSchema.parse(response)).not.toThrow();
  expect(Object.keys(response.export)).toStrictEqual([
    "id",
    "report",
    "format",
    "status",
    "createdAt",
    "expiresAt",
    "byteSize",
    "rowCount",
  ]);
  expect(response.export.status).toBe("queued");
  expect(response.export.createdAt).toBe(NOW.toISOString());
  expect(response.export.expiresAt).toBeNull();
  const job = exportJobsOf(getState()).at(-1);
  expect(job?.scope).toBe("clinic");
  expect(job?.params.branchIds).toStrictEqual(branchesOf().map((b) => b.id));
  expect(job?.params.groupBy).toBe("day");
  expect(job?.artifact).toBeNull();
  expect(job?.ownPatientIds).toBeNull();
  expect(JSON.stringify(response)).not.toContain(job?.params.branchIds[0] ?? "none");
  expect(JSON.stringify(response)).not.toContain(job?.requestedBy ?? "none");
});

it("freezes the group defaults and keeps an explicit groupBy", () => {
  const summary = admitReportExport(getState(), admin(), request({ report: "period_summary" }), NOW);
  const job = exportJobsOf(getState()).at(-1);
  expect(summary.export.report).toBe("period_summary");
  expect(job?.params.groupBy).toBe("month");
  admitReportExport(getState(), admin(), request({ groupBy: "month" }), NOW);
  expect(exportJobsOf(getState()).at(-1)?.params.groupBy).toBe("month");
  expect(exportJobsOf(getState()).at(-1)?.params).not.toHaveProperty("branchNames");
});

it("copies the frozen branch list: later state edits do not rewrite it", () => {
  admitReportExport(getState(), admin(), request(), NOW);
  const job = exportJobsOf(getState()).at(-1);
  const frozen = [...(job?.params.branchIds ?? [])];
  getState().branches.splice(0, getState().branches.length);
  expect(job?.params.branchIds).toStrictEqual(frozen);
});

it("accepts 1096 inclusive days and refuses 1097 as report_range_too_long", () => {
  const ok = admitReportExport(
    getState(),
    admin(),
    request({ from: "2024-01-01", to: "2026-12-31" }),
    NOW,
  );
  expect(ok.export.status).toBe("queued");
  expect(codeOf(() => admitReportExport(getState(), admin(), request({ from: "2024-01-01", to: "2027-01-01" }), NOW))).toBe(
    "report_range_too_long",
  );
});

it("refuses a groupBy on a non-grouped report and an unknown key as validation", () => {
  expect(
    codeOf(() =>
      admitReportExport(getState(), admin(), request({ report: "outstanding", groupBy: "day" }), NOW),
    ),
  ).toBe("validation");
  expect(
    codeOf(() => admitReportExport(getState(), admin(), request({ extra: true }), NOW)),
  ).toBe("validation");
});

it("checks the guard before the body: a suspended clinic with malformed input is blocked", () => {
  const clinic = getState().clinics.find((c) => c.id === clinicIdAt(0));
  if (!clinic) throw new Error("seed");
  clinic.status = "suspended";
  expect(codeOf(() => admitReportExport(getState(), admin(), { nope: 1 }, NOW))).toBe(
    "subscription_blocked",
  );
});

it("a missing report key or a missing covering key is forbidden", () => {
  expect(
    codeOf(() => admitReportExport(getState(), personaWith(["view:payments:clinic"]), request(), NOW)),
  ).toBe("forbidden");
  expect(
    codeOf(() =>
      admitReportExport(getState(), personaWith(["view:report_takings:clinic"]), request(), NOW),
    ),
  ).toBe("forbidden");
});

const CLINIC_KEYS: Partial<Record<ReportId, string[]>> = {
  daily_takings: ["view:report_takings:clinic", "view:payments:clinic"],
  period_summary: ["view:report_takings:clinic", "view:invoices:clinic", "view:payments:clinic"],
  by_service: ["view:report_analytics:clinic", "view:invoices:clinic"],
  by_doctor: ["view:report_analytics:clinic", "view:invoices:clinic"],
  outstanding: ["view:report_patients:clinic", "view:invoices:clinic"],
  patient_credit: ["view:report_patients:clinic", "view:payments:clinic"],
  refunds: ["view:report_patients:clinic", "view:payments:clinic"],
  discounts: ["view:report_patients:clinic", "view:invoices:clinic"],
  cash_closings: ["view:report_takings:clinic", "view:cash_closings:clinic"],
};

it("every report admits with its own scope from exactly its keys", () => {
  for (const report of REPORT_IDS) {
    resetMockData();
    const keys =
      report === "own_summary"
        ? ["view:report_own:own", "view:invoices:own"]
        : (CLINIC_KEYS[report] ?? []);
    admitReportExport(getState(), personaWith(keys), request({ report }), NOW);
    const job = exportJobsOf(getState()).at(-1);
    expect(job?.report).toBe(report);
    expect(job?.scope).toBe(report === "own_summary" ? "own" : "clinic");
  }
});

it("branch scope freezes active assigned branches; clinic scope keeps inactive ones", () => {
  const [a, b] = branchesOf();
  if (!a || !b) throw new Error("seed");
  const keys = ["view:report_takings:branch", "view:payments:branch"];
  b.isActive = false;
  admitReportExport(getState(), personaWith(keys, [a.id, b.id]), request(), NOW);
  expect(exportJobsOf(getState()).at(-1)?.params.branchIds).toStrictEqual([a.id]);
  admitReportExport(getState(), admin(), request(), NOW);
  expect(exportJobsOf(getState()).at(-1)?.params.branchIds).toStrictEqual([a.id, b.id]);
  expect(
    codeOf(() =>
      admitReportExport(
        getState(),
        personaWith(keys, [a.id]),
        request({ branchId: b.id }),
        NOW,
      ),
    ),
  ).toBe("forbidden");
  admitReportExport(getState(), personaWith(keys, [a.id]), request({ branchId: a.id }), NOW);
  expect(exportJobsOf(getState()).at(-1)?.params.branchIds).toStrictEqual([a.id]);
});

it("the own summary needs the own invoice key, not a wider one", () => {
  const own = { report: "own_summary" };
  expect(
    codeOf(() =>
      admitReportExport(
        getState(),
        personaWith(["view:report_own:own", "view:invoices:branch"]),
        request(own),
        NOW,
      ),
    ),
  ).toBe("forbidden");
  admitReportExport(
    getState(),
    personaWith(["view:report_own:own", "view:invoices:own"]),
    request(own),
    NOW,
  );
  expect(exportJobsOf(getState()).at(-1)?.scope).toBe("own");
});

it("nine queued admit, the tenth admits, the eleventh is export_busy", () => {
  for (let index = 0; index < EXPORT_QUEUE_LIMIT; index += 1) {
    admitReportExport(getState(), admin(), request(), NOW);
  }
  expect(exportJobsOf(getState())).toHaveLength(EXPORT_QUEUE_LIMIT);
  expect(codeOf(() => admitReportExport(getState(), admin(), request(), NOW))).toBe("export_busy");
});

it("a running job of the same caller refuses; queued jobs of the same caller do not", () => {
  admitReportExport(getState(), admin(), request(), NOW);
  admitReportExport(getState(), admin(), request(), NOW);
  const first = exportJobsOf(getState())[0];
  if (!first) throw new Error("missing job");
  first.status = "running";
  expect(codeOf(() => admitReportExport(getState(), admin(), request(), NOW))).toBe("export_busy");
  first.status = "queued";
  admitReportExport(getState(), admin(), request(), NOW);
  expect(exportJobsOf(getState())).toHaveLength(3);
});

it("other clinics and finished jobs do not count toward the cap", () => {
  for (let index = 0; index < EXPORT_QUEUE_LIMIT; index += 1) fakeJob("other-clinic", "queued");
  for (const status of ["failed", "done", "expired", "purged"] as const) {
    fakeJob(clinicIdAt(0), status);
  }
  admitReportExport(getState(), admin(), request(), NOW);
  expect(exportJobsOf(getState()).at(-1)?.status).toBe("queued");
});

it("the check and the insert are one synchronous step with no async gap", () => {
  const result = admitReportExport(getState(), admin(), request(), NOW);
  expect(result).not.toBeInstanceOf(Promise);
  const attempts = Array.from({ length: EXPORT_QUEUE_LIMIT }, () =>
    codeOf(() => admitReportExport(getState(), admin(), request(), NOW)),
  );
  // One job already queued above: nine more admit, every further attempt is busy.
  expect(attempts.slice(0, EXPORT_QUEUE_LIMIT - 1).every((code) => code === "admitted")).toBe(false);
  expect(exportJobsOf(getState())).toHaveLength(EXPORT_QUEUE_LIMIT);
  expect(attempts.at(-1)).toBe("export_busy");
});

it("admission and refusal write no audit row and no artifact", () => {
  const before = structuredClone(getState().clinicAudit);
  admitReportExport(getState(), admin(), request(), NOW);
  for (let index = 0; index < EXPORT_QUEUE_LIMIT; index += 1) {
    codeOf(() => admitReportExport(getState(), admin(), request(), NOW));
  }
  expect(getState().clinicAudit).toStrictEqual(before);
  expect(exportJobsOf(getState()).every((job) => job.artifact === null)).toBe(true);
});
