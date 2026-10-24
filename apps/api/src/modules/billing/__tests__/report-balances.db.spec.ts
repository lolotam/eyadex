import * as reports from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { applyCredit, namedPatient, pay, refund } from "./billing-fixtures.ts";
import { editTo } from "./money-fixtures.ts";
import {
  expectForbidden,
  foreignInvoice,
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
let creditPatient: string;
beforeAll(async () => {
  f = await reportFixture();
  const { h, C } = f;
  for (const day of [
    "2026-07-02",
    "2026-06-02",
    "2026-06-01",
    "2026-05-03",
    "2026-05-02",
    "2026-04-03",
    "2026-04-02",
  ]) {
    await issueReportInvoice(f, f.patientD, C.branchD, [reportFreeLine("100")], null, day);
  }
  const due = await issueReportInvoice(
    f,
    f.patientR,
    C.branchR,
    [reportFreeLine("500")],
    null,
    "2026-07-01",
  );
  expect(
    (await pay(h, C.admin.cookie, due.id, { method: "cash", amountMinor: "200" })).statusCode,
  ).toBe(201);
  creditPatient = await namedPatient(h, C, C.branchR, "مراجع رصيد منفصل");
  const credit = await issueReportInvoice(f, creditPatient, C.branchR, [reportFreeLine("1000")]);
  expect(
    (await pay(h, C.admin.cookie, credit.id, { method: "knet", amountMinor: "1000" })).statusCode,
  ).toBe(201);
  expect((await editTo(h, C.admin.cookie, credit.id, "600", '"1"')).statusCode).toBe(200);
  const target = await issueReportInvoice(f, creditPatient, C.branchR, [reportFreeLine("100")]);
  expect((await applyCredit(h, C.admin.cookie, target.id, "100")).statusCode).toBe(201);
  expect(
    (
      await refund(h, C.admin.cookie, credit.id, {
        source: "credit",
        method: "cash",
        amountMinor: "50",
        reason: "sample return",
      })
    ).statusCode,
  ).toBe(201);
  const second = await issueReportInvoice(f, f.patientD, C.branchD, [reportFreeLine("1000")]);
  expect(
    (await pay(h, C.admin.cookie, second.id, { method: "knet", amountMinor: "1000" })).statusCode,
  ).toBe(201);
  expect((await editTo(h, C.admin.cookie, second.id, "700", '"1"')).statusCode).toBe(200);
  await h.owner`UPDATE patient_credits SET created_at = '2025-12-31T22:30:00Z'
    WHERE clinic_id = ${C.clinicId}`;
  const foreign = await foreignInvoice(f);
  expect(
    (
      await pay(h, f.other.admin.cookie, foreign.id, {
        method: "knet",
        amountMinor: "999999",
      })
    ).statusCode,
  ).toBe(201);
  expect((await editTo(h, f.other.admin.cookie, foreign.id, "1", '"1"')).statusCode).toBe(200);
  await foreignInvoice(f);
}, 120_000);
afterAll(() => closeHarness(f.h));

describe("R5 outstanding balances", () => {
  it("ages from the issue day to the injected clinic today, with all boundary days", async () => {
    const clock = f.h.app.get<Clock>(CLOCK);
    const now = clock.now;
    clock.now = () => new Date("2026-07-01T21:30:00Z");
    try {
      const res = await f.get("outstanding");
      expect(res.statusCode, res.body).toBe(200);
      const report = reports.reportOutstandingResponseSchema.parse(res.json());
      expect(report.total).toBe(8);
      expect(report.items.map((row) => row.businessDate)).toEqual(
        expect.arrayContaining([
          "2026-07-02",
          "2026-06-02",
          "2026-06-01",
          "2026-05-03",
          "2026-05-02",
          "2026-04-03",
          "2026-04-02",
        ]),
      );
      expect(report.summary).toEqual(
        expect.arrayContaining([
          { branchId: f.C.branchD, ageBucket: "0_30", invoiceCount: 2, owedMinor: "200" },
          { branchId: f.C.branchD, ageBucket: "31_60", invoiceCount: 2, owedMinor: "200" },
          { branchId: f.C.branchD, ageBucket: "61_90", invoiceCount: 2, owedMinor: "200" },
          { branchId: f.C.branchD, ageBucket: "over_90", invoiceCount: 1, owedMinor: "100" },
          { branchId: f.C.branchR, ageBucket: "0_30", invoiceCount: 1, owedMinor: "300" },
        ]),
      );
      expect(report.items.find((row) => row.branchId === f.C.branchR)).toMatchObject({
        totalMinor: "500",
        paidMinor: "200",
        owedMinor: "300",
        patientName: "مراجع تقارير ر",
      });
      const page = reports.reportOutstandingResponseSchema.parse(
        (await f.get("outstanding", f.C.admin.cookie, "limit=2")).json(),
      );
      expect(page.summary).toEqual(report.summary);
      expect(page.total).toBe(8);
      const next = reports.reportOutstandingResponseSchema.parse(
        (await f.get("outstanding", f.C.admin.cookie, `limit=2&cursor=${page.nextCursor}`)).json(),
      );
      expect(next.items).toHaveLength(2);
      expect(
        next.items.every((row) => !page.items.some((first) => first.invoiceId === row.invoiceId)),
      ).toBe(true);
      expect(next.summary).toEqual(report.summary);
    } finally {
      clock.now = now;
    }
  });

  it("respects branch, own and separate report keys", async () => {
    const branch = reports.reportOutstandingResponseSchema.parse(
      (await f.get("outstanding", f.branch.cookie)).json(),
    );
    expect(branch.total).toBe(1);
    expect(branch.items[0]?.owedMinor).toBe("300");
    await expectForbidden(f, "outstanding", f.branch.cookie, `branchId=${f.C.branchD}`);
    await expectForbidden(f, "outstanding", f.C.doctor.cookie);
    await expectForbidden(f, "outstanding", f.desk.cookie);
    await expectForbidden(f, "outstanding", f.C.admin.cookie, `branchId=${f.other.branchD}`);
    const uncovered = await memberOn(
      f.h,
      f.C.admin,
      await customRole(f.h, f.C.clinicId, ["view:report_patients:branch"]),
      { allBranches: false, branchIds: [f.C.branchR] },
    );
    await f.invalidate.clinicChanged(f.C.clinicId);
    await expectForbidden(f, "outstanding", uncovered.cookie);
  });
});

describe("R6 clinic credit balances", () => {
  it("subtracts funded allocations and refunds without cutting the ledger to the report range", async () => {
    const res = await f.get("patient-credit");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportPatientCreditResponseSchema.parse(res.json());
    expect(report.total).toBe(2);
    expect(report.items).toEqual(
      expect.arrayContaining([
        {
          patientId: creditPatient,
          patientName: "مراجع رصيد منفصل",
          balanceMinor: "250",
          oldestCreditDay: "2026-01-01",
          currency: "KWD",
        },
        {
          patientId: f.patientD,
          patientName: "مراجع تقارير د",
          balanceMinor: "300",
          oldestCreditDay: "2026-01-01",
          currency: "KWD",
        },
      ]),
    );
    const filtered = await f.get(
      "patient-credit",
      f.C.admin.cookie,
      `branchId=${f.C.branchR}`,
      "from=2026-06-01&to=2026-06-30",
    );
    expect(filtered.json()).toEqual(report);
  });

  it("pages by patient id, rejects branch and own scopes, and writes no access audit", async () => {
    const before = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
      WHERE clinic_id = ${f.C.clinicId} AND category = 'patient_access'`;
    const page = reports.reportPatientCreditResponseSchema.parse(
      (await f.get("patient-credit", f.C.admin.cookie, "limit=1")).json(),
    );
    const next = reports.reportPatientCreditResponseSchema.parse(
      (await f.get("patient-credit", f.C.admin.cookie, `limit=1&cursor=${page.nextCursor}`)).json(),
    );
    expect(page.total).toBe(2);
    expect(next.total).toBe(2);
    expect(next.nextCursor).toBeNull();
    expect(next.items[0]?.patientId).not.toBe(page.items[0]?.patientId);
    for (const cookie of [f.branch.cookie, f.C.doctor.cookie, f.desk.cookie]) {
      await expectForbidden(f, "patient-credit", cookie);
    }
    await expectForbidden(f, "patient-credit", f.C.admin.cookie, `branchId=${f.other.branchD}`);
    const after = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
      WHERE clinic_id = ${f.C.clinicId} AND category = 'patient_access'`;
    expect(after).toEqual(before);
  });
});
