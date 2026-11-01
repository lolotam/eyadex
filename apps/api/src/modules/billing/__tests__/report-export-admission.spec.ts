import { REPORT_IDS, type ReportId } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import { ApiError, codeForStatus } from "../../../shared/errors.ts";
import type { BillingActor } from "../domain/billing-actor.ts";
import {
  admitExportScope,
  decideExportAdmission,
  exportQueueLimit,
  parseReportExportRequest,
  reportExportLockName,
} from "../domain/report-export-admission.ts";
import { reportBranchIds, reportScope } from "../domain/report-scope.ts";
import { ReportExports } from "../use-cases/report-exports/report-exports.ts";

const EAST = "11111111-1111-4111-8111-111111111111";
const INACTIVE = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
const CLINIC_BRANCHES = [EAST, INACTIVE];
const RANGE = { from: "2026-01-01", to: "2026-01-31" };
const THREE_YEARS = { from: "2024-01-01", to: "2026-12-31" };
const TOO_LONG = { from: "2024-01-01", to: "2027-01-01" };

const actor = (permissions: readonly string[], all = false): BillingActor => ({
  clinicId: "clinic",
  userId: "user",
  membershipId: "member",
  permissions,
  member: all ? { all: true } : { all: false, branchIds: [EAST] },
});

const request = (report: ReportId, extra: Record<string, unknown> = {}) => ({
  report,
  ...RANGE,
  format: "csv" as const,
  language: "ar" as const,
  ...extra,
});

const desk = actor([
  "view:report_takings:branch",
  "view:invoices:branch",
  "view:payments:branch",
  "view:cash_closings:branch",
]);
const doctor = actor(["view:report_own:own", "view:invoices:own"]);
const admin = actor(
  [
    "view:report_takings:clinic",
    "view:report_analytics:clinic",
    "view:report_patients:clinic",
    "view:invoices:clinic",
    "view:payments:clinic",
    "view:cash_closings:clinic",
  ],
  true,
);

describe("export admission domain", () => {
  it("follows reportScope and reportBranchIds for every report, including inactive branches", () => {
    for (const report of REPORT_IDS) {
      const caller = report === "own_summary" ? doctor : admin;
      const reach = reportScope(caller, report);
      expect(reach, report).not.toBeNull();
      const frozen = admitExportScope(caller, request(report), CLINIC_BRANCHES);
      expect(frozen.scope).toBe(reach!.scope);
      expect(frozen.branchIds).toEqual(reportBranchIds(reach!, CLINIC_BRANCHES));
      expect(frozen.branchIds).toContain(INACTIVE);
      expect(frozen.params).not.toHaveProperty("branchId");
      expect(frozen.params).not.toHaveProperty("patientId");
      for (const key of caller.permissions) {
        const narrower = actor(
          caller.permissions.filter((held) => held !== key),
          caller.member.all,
        );
        const stillOpen = reportScope(narrower, report) !== null;
        if (stillOpen) {
          expect(admitExportScope(narrower, request(report), CLINIC_BRANCHES).scope).toBe(
            reportScope(narrower, report)!.scope,
          );
        } else {
          expect(() => admitExportScope(narrower, request(report), CLINIC_BRANCHES)).toThrow(
            expect.objectContaining({ code: "forbidden" }),
          );
        }
      }
    }
  });

  it("opens only the receptionist's takings reports, and own only with the own invoice key", () => {
    expect(REPORT_IDS.filter((id) => reportScope(desk, id) !== null)).toEqual([
      "daily_takings",
      "period_summary",
      "cash_closings",
    ]);
    expect(() => admitExportScope(desk, request("outstanding"), CLINIC_BRANCHES)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(() => admitExportScope(desk, request("own_summary"), CLINIC_BRANCHES)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(
      reportScope(actor(["view:report_takings:branch", "view:invoices:clinic"]), "own_summary"),
    ).toBeNull();
    for (const covering of ["branch", "clinic"] as const) {
      expect(() =>
        admitExportScope(
          actor(["view:report_own:own", `view:invoices:${covering}`]),
          request("own_summary"),
          CLINIC_BRANCHES,
        ),
      ).toThrow(expect.objectContaining({ code: "forbidden" }));
    }
    const own = admitExportScope(doctor, request("own_summary"), CLINIC_BRANCHES);
    expect(own.scope).toBe("own");
    expect(own.branchIds).toEqual(
      reportBranchIds(reportScope(doctor, "own_summary")!, CLINIC_BRANCHES),
    );
  });

  it("requires both clinic keys for patient credit and refuses a foreign branch filter", () => {
    for (const keys of [
      ["view:report_patients:branch", "view:payments:clinic"],
      ["view:report_patients:clinic", "view:payments:branch"],
    ]) {
      expect(() =>
        admitExportScope(actor(keys, true), request("patient_credit"), CLINIC_BRANCHES),
      ).toThrow(expect.objectContaining({ code: "forbidden" }));
    }
    const credit = actor(["view:report_patients:clinic", "view:payments:clinic"], true);
    expect(admitExportScope(credit, request("patient_credit"), CLINIC_BRANCHES).scope).toBe(
      "clinic",
    );
    expect(() =>
      admitExportScope(credit, request("patient_credit", { branchId: FOREIGN }), CLINIC_BRANCHES),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(
      admitExportScope(credit, request("patient_credit", { branchId: INACTIVE }), CLINIC_BRANCHES)
        .branchIds,
    ).toEqual([INACTIVE]);
  });

  it("freezes the filter and the grouped default without a widenable branch field", () => {
    const daily = admitExportScope(admin, request("daily_takings"), CLINIC_BRANCHES);
    expect(daily.params).toEqual({
      ...RANGE,
      language: "ar",
      branchIds: CLINIC_BRANCHES,
      groupBy: "day",
    });
    expect(
      admitExportScope(admin, request("daily_takings", { groupBy: "month" }), CLINIC_BRANCHES)
        .params.groupBy,
    ).toBe("month");
    expect(admitExportScope(admin, request("period_summary"), CLINIC_BRANCHES).params.groupBy).toBe(
      "month",
    );
    expect(
      admitExportScope(admin, request("by_service"), CLINIC_BRANCHES).params,
    ).not.toHaveProperty("groupBy");
    expect(admitExportScope(desk, request("daily_takings"), CLINIC_BRANCHES).branchIds).toEqual([
      EAST,
    ]);
    expect(() =>
      admitExportScope(desk, request("daily_takings", { branchId: INACTIVE }), CLINIC_BRANCHES),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  it("accepts 1096 inclusive days and refuses 1097 as report_range_too_long", () => {
    expect(parseReportExportRequest(request("by_service", THREE_YEARS)).to).toBe("2026-12-31");
    expect(() => parseReportExportRequest(request("by_service", TOO_LONG))).toThrow(ApiError);
    expect(() => parseReportExportRequest(request("by_service", TOO_LONG))).toThrow(
      expect.objectContaining({ code: "report_range_too_long", status: 400 }),
    );
  });

  it("refuses unknown, strict and invalid fields as validation, not a range error", () => {
    for (const extra of [
      { patientId: EAST },
      { format: "pdf" },
      { language: "fr" },
      { report: "payroll" },
      { groupBy: "year" },
      { from: "2026-02-30" },
      { from: "2026-03-02", to: "2026-03-01" },
    ]) {
      expect(() => parseReportExportRequest({ ...request("daily_takings"), ...extra })).toThrow(
        expect.objectContaining({ code: "validation" }),
      );
    }
    expect(() => parseReportExportRequest(request("own_summary", { groupBy: "day" }))).toThrow(
      expect.objectContaining({ code: "validation" }),
    );
  });

  it("rejects a full queue or a running member, and a missing max does not typecheck", () => {
    expect(
      decideExportAdmission({ runningForMember: false, queuedCount: 2, maxQueuedPerClinic: 2 }),
    ).toBe("busy");
    expect(
      decideExportAdmission({ runningForMember: false, queuedCount: 1, maxQueuedPerClinic: 2 }),
    ).toBe("admit");
    expect(
      decideExportAdmission({ runningForMember: true, queuedCount: 0, maxQueuedPerClinic: 2 }),
    ).toBe("busy");
    expect(exportQueueLimit(1)).toBe(1);
    expect(exportQueueLimit(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const max of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => exportQueueLimit(max)).toThrow(TypeError);
    }
    expect(reportExportLockName("clinic")).toBe("finance-report-exports:clinic");
    expect(reportExportLockName("clinic").startsWith("finance:")).toBe(false);
    expect(new ApiError("export_busy")).toMatchObject({ code: "export_busy", status: 429 });
    expect(codeForStatus(429)).toBe("rate_limited");
    // @ts-expect-error maxQueuedPerClinic is required; a default would widen the queue
    decideExportAdmission({ runningForMember: false, queuedCount: 0 });
  });

  it("does not touch the database when the request or the constructor is refused", async () => {
    let touched = 0;
    const db = {
      withTenant: () => {
        touched += 1;
        return Promise.reject(new Error("database"));
      },
    };
    const deps = {
      db: db as never,
      clock: { now: () => new Date("2026-10-26T08:00:00.000Z") },
      ids: { newId: () => EAST },
      branches: { listForOptions: async () => [] },
      store: {
        lockClinic: async () => undefined,
        countQueued: async () => 0,
        memberHasRunning: async () => false,
        insertQueued: async () => undefined,
        readForRequester: async () => null,
      },
      maxQueuedPerClinic: 1,
    };
    expect(() => new ReportExports({ ...deps, maxQueuedPerClinic: 0 })).toThrow(TypeError);
    const useCase = new ReportExports(deps);
    await expect(useCase.request(admin, request("by_service", TOO_LONG))).rejects.toMatchObject({
      code: "report_range_too_long",
      status: 400,
    });
    await expect(useCase.request(desk, request("patient_credit"))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(useCase.status(admin, "not-a-uuid")).rejects.toMatchObject({ code: "not_found" });
    expect(touched).toBe(0);
    expect(() => {
      // @ts-expect-error maxQueuedPerClinic is a required constructor argument
      new ReportExports({ db: deps.db, clock: deps.clock, ids: deps.ids, branches: deps.branches });
    }).toThrow(TypeError);
  });
});
