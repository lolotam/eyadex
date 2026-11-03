import {
  reportDailyTakingsResponseSchema,
  reportPeriodSummaryResponseSchema,
} from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, expect, it } from "vitest";

import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { pay } from "./billing-fixtures.ts";
import {
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
const range = "from=2026-06-01&to=2026-07-31";

beforeAll(async () => {
  f = await reportFixture();
  const { h, C } = f;
  const entries = [
    [C.branchR, f.patientR, "1000", "2026-06-01", "2026-06-01T09:00:00Z"],
    [C.branchR, f.patientR, "2000", "2026-06-30", "2026-06-30T20:59:59Z"],
    [C.branchR, f.patientR, "4000", "2026-07-01", "2026-06-30T21:00:00Z"],
    [C.branchD, f.patientD, "8000", "2026-07-01", "2026-07-01T09:00:00Z"],
  ] as const;
  for (const [branchId, patientId, amountMinor, day, issuedAt] of entries) {
    const invoice = await issueReportInvoice(
      f,
      patientId,
      branchId,
      [reportFreeLine(amountMinor)],
      null,
      day,
    );
    const payment = await pay(h, C.admin.cookie, invoice.id, { method: "knet", amountMinor });
    expect(payment.statusCode, payment.body).toBe(201);
    await h.owner`UPDATE invoices SET issued_at = ${issuedAt}::timestamptz
      WHERE clinic_id = ${C.clinicId} AND id = ${invoice.id}`;
    await h.owner`UPDATE payments SET business_date = ${day}::date
      WHERE clinic_id = ${C.clinicId} AND invoice_id = ${invoice.id}`;
  }
}, 120_000);
afterAll(() => closeHarness(f.h));

it("R1 keeps separate months and restricts their totals to the reader's branches", async () => {
  for (const [cookie, expectedTotal, count] of [
    [f.C.admin.cookie, "15000", 3],
    [f.branch.cookie, "7000", 2],
  ] as const) {
    const response = await f.get("daily-takings", cookie, "groupBy=month", range);
    expect(response.statusCode, response.body).toBe(200);
    const report = reportDailyTakingsResponseSchema.parse(response.json());
    expect(report.totals).toEqual({
      inMinor: expectedTotal,
      outMinor: "0",
      netMinor: expectedTotal,
    });
    expect(report.rows).toHaveLength(count);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branchId: f.C.branchR, period: "2026-06", inMinor: "3000" }),
        expect.objectContaining({ branchId: f.C.branchR, period: "2026-07", inMinor: "4000" }),
      ]),
    );
  }
});

it("R2 assigns a UTC June invoice at Kuwait midnight to July without widening branch reach", async () => {
  const response = await f.get("period-summary", f.branch.cookie, "groupBy=month", range);
  expect(response.statusCode, response.body).toBe(200);
  const report = reportPeriodSummaryResponseSchema.parse(response.json());
  expect(report.totals).toMatchObject({ invoicedMinor: "7000", collectedMinor: "7000" });
  expect(report.rows).toHaveLength(2);
  expect(report.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ period: "2026-06", invoicedMinor: "3000", collectedMinor: "3000" }),
      expect.objectContaining({ period: "2026-07", invoicedMinor: "4000", collectedMinor: "4000" }),
    ]),
  );

  const june = await f.get(
    "period-summary",
    f.branch.cookie,
    "groupBy=day",
    "from=2026-06-30&to=2026-06-30",
  );
  expect(june.statusCode, june.body).toBe(200);
  const lastDay = reportPeriodSummaryResponseSchema.parse(june.json());
  expect(lastDay.totals).toMatchObject({ invoicedMinor: "2000", collectedMinor: "2000" });
  expect(lastDay.rows).toEqual([
    expect.objectContaining({ period: "2026-06-30", invoicedMinor: "2000" }),
  ]);
});
