import * as reports from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APP, call, closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { code } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { namedPatient, pay, refund } from "./billing-fixtures.ts";
import { editTo } from "./money-fixtures.ts";
import {
  expectForbidden,
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  reportNames,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
const pct = (bp: number) => ({ kind: "pct", bp, reason: "sample percentage" });
const amount = (minor: string) => ({ kind: "amount", minor, reason: "sample amount" });
beforeAll(async () => {
  f = await reportFixture();
  const { h, C } = f;
  await issueReportInvoice(f, f.patientD, C.branchD, [reportFreeLine("3", pct(3333))], amount("1"));
  const lines = [reportFreeLine("1000", pct(1000))];
  const r = await issueReportInvoice(f, f.patientR, C.branchR, lines, pct(500));
  const edited = await call(h, {
    host: APP,
    cookie: C.admin.cookie,
    method: "PATCH",
    url: `/v1/invoices/${r.id}`,
    headers: { "if-match": '"1"' },
    body: { lines, invoiceDiscount: pct(500) },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  await h.owner`UPDATE invoice_lines SET discounted_by = NULL
    WHERE clinic_id = ${C.clinicId} AND invoice_id = ${r.id} AND archived_at IS NULL`;
  await h.owner`UPDATE invoices SET discounted_by = ${C.doctorB.memberId}
    WHERE clinic_id = ${C.clinicId} AND id = ${r.id}`;
  await h.owner`UPDATE memberships SET status = 'deactivated' WHERE id = ${C.doctorB.memberId}`;
  for (const [branch, patient, total, source] of [
    [C.branchD, f.patientD, "5000", "payment"],
    [C.branchR, f.patientR, "3000", "credit"],
  ] as const) {
    const invoice = await issueReportInvoice(f, patient, branch, [reportFreeLine(total)]);
    const paid = await pay(h, C.admin.cookie, invoice.id, { method: "cash", amountMinor: total });
    expect(paid.statusCode, paid.body).toBe(201);
    if (source === "credit")
      expect((await editTo(h, C.admin.cookie, invoice.id, "2000", '"1"')).statusCode).toBe(200);
    const paymentId = (paid.json() as { payment: { id: string } }).payment.id;
    const returned = await refund(h, C.admin.cookie, invoice.id, {
      source,
      ...(source === "payment" ? { paymentId } : {}),
      method: "cash",
      amountMinor: source === "payment" ? "500" : "200",
      reason: "sample return",
    });
    expect(returned.statusCode, returned.body).toBe(201);
  }
  await h.owner`UPDATE refunds SET business_date = '2026-06-15' WHERE clinic_id = ${C.clinicId}`;
  const patient = await namedPatient(h, f.other, f.other.branchD, "مراجع غير متاح");
  const foreign = await issueReportInvoice(
    f,
    patient,
    f.other.branchD,
    [reportFreeLine("99999", amount("99"))],
    null,
    "2026-06-15",
    f.other,
  );
  const paid = await pay(h, f.other.admin.cookie, foreign.id, {
    method: "cash",
    amountMinor: "99900",
  });
  expect(paid.statusCode).toBe(201);
  expect(
    (
      await refund(h, f.other.admin.cookie, foreign.id, {
        source: "payment",
        paymentId: (paid.json() as { payment: { id: string } }).payment.id,
        method: "cash",
        amountMinor: "123",
        reason: "sample foreign return",
      })
    ).statusCode,
  ).toBe(201);
  await h.owner`UPDATE refunds SET business_date = '2026-06-15' WHERE clinic_id = ${f.other.clinicId}`;
}, 120_000);
afterAll(() => closeHarness(f.h));

describe("R7 refunds and R8 discounts", () => {
  it("R7 returns one refund per row, classified by the spent credit cause", async () => {
    const res = await f.get("refunds");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportRefundResponseSchema.parse(res.json());
    expect(report.total).toBe(2);
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchId: f.C.branchD,
          patientName: "مراجع تقارير د",
          source: "payment",
          amountMinor: "500",
        }),
        expect.objectContaining({
          branchId: f.C.branchR,
          patientName: "مراجع تقارير ر",
          source: "credit",
          amountMinor: "200",
        }),
      ]),
    );
    expect(report.items.every((row) => row.reason === "sample return")).toBe(true);
    const name = await reportNames(f, f.C.admin.memberId);
    expect(
      report.items.every(
        (row) => row.refundedBy === f.C.admin.memberId && row.refundedByName === name,
      ),
    ).toBe(true);
  });

  it("R8 counts each live discount once and uses its stored giver, including legacy nulls", async () => {
    const res = await f.get("discounts");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportDiscountResponseSchema.parse(res.json());
    expect(report.total).toBe(4);
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchId: f.C.branchD,
          kind: "line",
          discountMinor: "1",
          discountedBy: f.C.admin.memberId,
        }),
        expect.objectContaining({
          branchId: f.C.branchD,
          kind: "invoice",
          discountMinor: "1",
          discountedBy: f.C.admin.memberId,
        }),
        expect.objectContaining({
          branchId: f.C.branchR,
          kind: "line",
          discountMinor: "100",
          discountedBy: null,
          discountedByName: null,
        }),
        expect.objectContaining({
          branchId: f.C.branchR,
          kind: "invoice",
          discountMinor: "45",
          discountedBy: f.C.doctorB.memberId,
          discountedByName: await reportNames(f, f.C.doctorB.memberId),
        }),
      ]),
    );
    expect(report.items.every((row) => row.patientName.startsWith("مراجع تقارير"))).toBe(true);
  });

  it("pages refunds and discounts by row id, never duplicates archived discounts, and writes no access audit", async () => {
    const before = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
      WHERE clinic_id = ${f.C.clinicId} AND category = 'patient_access'`;
    for (const [route, count] of [
      ["refunds", 2],
      ["discounts", 4],
    ] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < count; i++) {
        const res = await f.get(
          route,
          f.C.admin.cookie,
          `limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        );
        expect(res.statusCode, res.body).toBe(200);
        const page = res.json() as { items: unknown[]; nextCursor: string | null; total: number };
        expect(page.total).toBe(count);
        expect(page.items).toHaveLength(1);
        seen.push(JSON.stringify(page.items[0]));
        cursor = page.nextCursor;
        if (i < count - 1) expect(cursor).not.toBeNull();
      }
      expect(cursor).toBeNull();
      expect(new Set(seen).size).toBe(count);
    }
    for (const route of ["outstanding", "patient-credit", "refunds", "discounts"]) {
      for (const extra of ["cursor=not-a-cursor", "limit=101"]) {
        const res = await f.get(route, f.C.admin.cookie, extra);
        expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
      }
    }
    const after = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
      WHERE clinic_id = ${f.C.clinicId} AND category = 'patient_access'`;
    expect(after).toEqual(before);
  });

  it("branch readers see only R, own readers see neither, and another clinic stays inaccessible", async () => {
    for (const [route, count] of [
      ["refunds", 1],
      ["discounts", 2],
    ] as const) {
      const res = await f.get(route, f.branch.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const report = res.json() as { items: { branchId: string }[]; total: number };
      expect(report.total).toBe(count);
      expect(report.items.every((row) => row.branchId === f.C.branchR)).toBe(true);
      await expectForbidden(f, route, f.branch.cookie, `branchId=${f.C.branchD}`);
      await expectForbidden(f, route, f.C.doctor.cookie);
      await expectForbidden(f, route, f.desk.cookie);
      await expectForbidden(f, route, f.C.admin.cookie, `branchId=${f.other.branchD}`);
    }
  });
});
