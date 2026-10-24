import * as reports from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { code } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { applyCredit, pay, refund } from "./billing-fixtures.ts";
import { closingSteps, editTo, voidInvoice } from "./money-fixtures.ts";
import {
  expectForbidden,
  foreignInvoice,
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  reportNames,
  REPORT_ROUTES,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
beforeAll(async () => {
  f = await reportFixture();
  const { h, C } = f;
  const d = await issueReportInvoice(f, f.patientD, C.branchD, [reportFreeLine("10000")]);
  const r = await issueReportInvoice(f, f.patientR, C.branchR, [reportFreeLine("20000")]);
  const payment = await pay(h, C.admin.cookie, d.id, { method: "knet", amountMinor: "7000" });
  expect(payment.statusCode, payment.body).toBe(201);
  expect(
    (await pay(h, C.admin.cookie, r.id, { method: "cash", amountMinor: "20000" })).statusCode,
  ).toBe(201);
  expect((await editTo(h, C.admin.cookie, r.id, "15000", '"1"')).statusCode).toBe(200);
  const paymentId = (payment.json() as { payment: { id: string } }).payment.id;
  expect(
    (
      await refund(h, C.admin.cookie, d.id, {
        source: "payment",
        paymentId,
        method: "knet",
        amountMinor: "1000",
        reason: "sample return",
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await refund(h, C.admin.cookie, r.id, {
        source: "credit",
        method: "cash",
        amountMinor: "500",
        reason: "sample credit return",
      })
    ).statusCode,
  ).toBe(201);
  const target = await issueReportInvoice(f, f.patientR, C.branchR, [reportFreeLine("2000")]);
  expect((await applyCredit(h, C.admin.cookie, target.id, "1000")).statusCode).toBe(201);
  const voided = await issueReportInvoice(f, f.patientD, C.branchD, [reportFreeLine("300")]);
  expect((await voidInvoice(h, C.admin.cookie, voided.id)).statusCode).toBe(200);
  const steps = closingSteps(h, C);
  const shown = await steps.preview();
  expect(shown.expectedMinor).toBe("19500");
  const closed = await steps.closeWith(shown, "19400", "sample shortage");
  expect(closed.statusCode, closed.body).toBe(201);
  await h.owner`UPDATE payments SET business_date = '2026-06-15' WHERE clinic_id = ${C.clinicId}`;
  await h.owner`UPDATE refunds SET business_date = '2026-06-16' WHERE clinic_id = ${C.clinicId}`;
  await h.owner`UPDATE payment_allocations SET created_at = '2026-06-17T09:00:00Z',
    business_date = '2026-06-17' WHERE clinic_id = ${C.clinicId} AND credit_id IS NOT NULL`;
  await h.owner`UPDATE cash_closings SET business_date = '2026-06-17' WHERE clinic_id = ${C.clinicId}`;
  const foreign = await foreignInvoice(f);
  expect(
    (await pay(h, f.other.admin.cookie, foreign.id, { method: "cash", amountMinor: "999999" }))
      .statusCode,
  ).toBe(201);
  await h.owner`UPDATE payments SET business_date = '2026-06-15' WHERE clinic_id = ${f.other.clinicId}`;
  const foreignSteps = closingSteps(h, f.other);
  const foreignPreview = await foreignSteps.preview(f.other.branchD);
  const foreignClosing = await foreignSteps.closeWith(
    foreignPreview,
    "999999",
    undefined,
    f.other.branchD,
  );
  expect(foreignClosing.statusCode, foreignClosing.body).toBe(201);
  await h.owner`UPDATE cash_closings SET business_date = '2026-06-17'
    WHERE clinic_id = ${f.other.clinicId}`;
}, 120_000);
afterAll(() => closeHarness(f.h));

describe("R1/R2/R9 takings reports", () => {
  it("groups stored movement days into months and builds exact signed totals", async () => {
    const daily = await f.get("daily-takings");
    expect(daily.statusCode, daily.body).toBe(200);
    const day = reports.reportDailyTakingsResponseSchema.parse(daily.json());
    expect(day).toMatchObject({
      currency: "KWD",
      currencyExponent: 3,
      totals: { inMinor: "27000", outMinor: "1500", netMinor: "25500" },
    });
    expect(day.rows).toHaveLength(4);
    expect(
      day.rows
        .filter((row) => row.period === "2026-06-16")
        .map((row) => row.netMinor)
        .sort(),
    ).toEqual(["-1000", "-500"]);
    const month = reports.reportDailyTakingsResponseSchema.parse(
      (await f.get("daily-takings", f.C.admin.cookie, "groupBy=month")).json(),
    );
    expect(month.rows).toHaveLength(2);
    expect(month.rows.every((row) => row.period === "2026-06")).toBe(true);
    expect(month.totals).toEqual(day.totals);
  });

  it("R2 separates billed, collected, refunds, credit applications and voids", async () => {
    const res = await f.get("period-summary");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportPeriodSummaryResponseSchema.parse(res.json());
    expect(report.totals).toEqual({
      invoicedMinor: "27000",
      discountMinor: "0",
      taxMinor: "0",
      collectedMinor: "27000",
      refundedMinor: "1500",
      creditAppliedMinor: "1000",
      voidCount: 1,
    });
    expect(report.rows).toHaveLength(2);
    const day = reports.reportPeriodSummaryResponseSchema.parse(
      (await f.get("period-summary", f.C.admin.cookie, "groupBy=day")).json(),
    );
    expect(day.totals).toEqual(report.totals);
    expect(
      day.rows.some((row) => row.period === "2026-06-17" && row.creditAppliedMinor === "1000"),
    ).toBe(true);
  });

  it("R9 reads the saved closing and the membership name", async () => {
    const res = await f.get("cash-closings");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportCashClosingResponseSchema.parse(res.json());
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      branchId: f.C.branchR,
      expectedMinor: "19500",
      countedMinor: "19400",
      differenceMinor: "-100",
      notePresent: true,
      closedBy: f.C.admin.memberId,
      closedByName: await reportNames(f, f.C.admin.memberId),
    });
    expect(report.totals).toEqual({
      expectedMinor: "19500",
      countedMinor: "19400",
      differenceMinor: "-100",
    });
  });

  it("restricts branch readers, rejects own readers, and permits the receptionist only R1/R2/R9", async () => {
    for (const report of ["daily-takings", "period-summary", "cash-closings"]) {
      const res = await f.get(report, f.branch.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const rows = (res.json() as { rows: { branchId: string }[] }).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.branchId === f.C.branchR)).toBe(true);
      await expectForbidden(f, report, f.branch.cookie, `branchId=${f.C.branchD}`);
      await expectForbidden(f, report, f.C.doctor.cookie);
      await expectForbidden(f, report, f.C.admin.cookie, `branchId=${f.other.branchD}`);
    }
    for (const report of REPORT_ROUTES) {
      const res = await f.get(report, f.desk.cookie);
      expect(res.statusCode, `${report}: ${res.body}`).toBe(
        ["daily-takings", "period-summary", "cash-closings"].includes(report) ? 200 : 403,
      );
    }
    const branch = reports.reportDailyTakingsResponseSchema.parse(
      (await f.get("daily-takings", f.branch.cookie)).json(),
    );
    expect(branch.totals).toEqual({ inMinor: "20000", outMinor: "500", netMinor: "19500" });
  });

  it("clinic scope includes inactive branches and uses the caller's preferred language", async () => {
    const { h, C } = f;
    await h.owner`UPDATE branches SET is_active = false, name_ar = 'فرع تقارير', name_en = 'Report branch'
      WHERE clinic_id = ${C.clinicId} AND id = ${C.branchR}`;
    await h.owner`UPDATE memberships SET preferred_language = 'en' WHERE id = ${C.admin.memberId}`;
    await f.invalidate.clinicChanged(C.clinicId);
    try {
      const res = await f.get("daily-takings", C.admin.cookie, `branchId=${C.branchR}`);
      expect(res.statusCode, res.body).toBe(200);
      const report = reports.reportDailyTakingsResponseSchema.parse(res.json());
      expect(report.rows.every((row) => row.branchName === "Report branch")).toBe(true);
      expect(report.totals.inMinor).toBe("20000");
    } finally {
      await h.owner`UPDATE branches SET is_active = true WHERE id = ${C.branchR}`;
      await h.owner`UPDATE memberships SET preferred_language = 'ar' WHERE id = ${C.admin.memberId}`;
      await f.invalidate.clinicChanged(C.clinicId);
    }
  });

  it("rejects 367 inclusive days on every route before querying", async () => {
    for (const report of REPORT_ROUTES) {
      const cookie = report === "own-summary" ? f.C.doctor.cookie : f.C.admin.cookie;
      const res = await f.get(report, cookie, "", "from=2026-01-01&to=2027-01-02");
      expect([res.statusCode, code(res)], report).toEqual([400, "report_range_too_long"]);
      expect(res.json()).toMatchObject({
        message_ar: expect.any(String),
        message_en: expect.any(String),
      });
    }
  });
});
