import * as reports from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APP, call, closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { voidInvoice } from "./money-fixtures.ts";
import {
  expectForbidden,
  foreignInvoice,
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  reportNames,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
beforeAll(async () => {
  f = await reportFixture();
  const { h, C } = f;
  // The invitation fixture defaults to English; these assertions exercise an Arabic caller.
  await h.owner`UPDATE memberships SET preferred_language = 'ar' WHERE id = ${C.admin.memberId}`;
  await f.invalidate.clinicChanged(C.clinicId);
  await h.owner`UPDATE clinics SET tax_rate_bp = 1000 WHERE id = ${C.clinicId}`;
  await h.owner`UPDATE clinic_services SET price_minor = 1000, name_ar = 'خدمة التقارير',
    name_en = 'Report service' WHERE clinic_id = ${C.clinicId} AND id = ${C.serviceId}`;
  const service = (providerId: string, quantity: number) => ({
    kind: "service",
    serviceId: C.serviceId,
    providerId,
    quantity,
    unitPriceMinor: "1000",
    discount: null,
  });
  const lines = [
    service(C.doctor.memberId, 1),
    service(C.doctorB.memberId, 2),
    reportFreeLine("500"),
  ];
  const discount = { kind: "amount", minor: "500", reason: "sample courtesy" };
  const invoice = await issueReportInvoice(f, f.patientD, C.branchD, lines, discount);
  // An edit archives the old lines; counting both generations would double this report's revenue.
  const edited = await call(h, {
    host: APP,
    cookie: C.admin.cookie,
    method: "PATCH",
    url: `/v1/invoices/${invoice.id}`,
    body: { lines, invoiceDiscount: discount },
    headers: { "if-match": '"1"' },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  await issueReportInvoice(f, f.patientR, C.branchR, [reportFreeLine("700")]);
  const voided = await issueReportInvoice(f, f.patientR, C.branchR, [reportFreeLine("999")]);
  expect((await voidInvoice(h, C.admin.cookie, voided.id)).statusCode).toBe(200);
  await issueReportInvoice(f, f.patientD, C.branchD, [reportFreeLine("888")], null, "2025-12-31");
  await foreignInvoice(f);
}, 120_000);
afterAll(() => closeHarness(f.h));

describe("R3/R4 billed analytics", () => {
  it("R3 includes live lines, net of both discounts, plus exactly one tax row", async () => {
    const res = await f.get("by-service");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportByServiceResponseSchema.parse(res.json());
    expect(report.totals).toEqual({
      lineCount: 4,
      quantity: 5,
      billedMinor: "3700",
      taxMinor: "370",
      totalMinor: "4070",
    });
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "service",
          serviceId: f.C.serviceId,
          name: "خدمة التقارير",
          lineCount: 2,
          quantity: 3,
          amountMinor: "2571",
        }),
        expect.objectContaining({ kind: "free", lineCount: 2, quantity: 2, amountMinor: "1129" }),
        expect.objectContaining({ kind: "tax", lineCount: 0, quantity: 0, amountMinor: "370" }),
      ]),
    );
    expect(report.rows).toHaveLength(3);
  });

  it("R4 resolves membership names and keeps unassigned lines separate", async () => {
    const res = await f.get("by-doctor");
    expect(res.statusCode, res.body).toBe(200);
    const report = reports.reportByDoctorResponseSchema.parse(res.json());
    expect(report.totals).toEqual({
      lineCount: 4,
      quantity: 5,
      billedMinor: "3700",
      taxMinor: "370",
      totalMinor: "4070",
    });
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: f.C.doctor.memberId,
          amountMinor: "857",
          name: await reportNames(f, f.C.doctor.memberId),
        }),
        expect.objectContaining({
          providerId: f.C.doctorB.memberId,
          amountMinor: "1714",
          name: await reportNames(f, f.C.doctorB.memberId),
        }),
        expect.objectContaining({
          kind: "none",
          providerId: null,
          name: "بدون دكتور",
          amountMinor: "1129",
        }),
        expect.objectContaining({ kind: "tax", amountMinor: "370" }),
      ]),
    );
    expect(report.rows).toHaveLength(4);
  });

  it("branch analytics contain only that branch, and own/takings keys cannot open them", async () => {
    for (const route of ["by-service", "by-doctor"]) {
      const res = await f.get(route, f.branch.cookie);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        totals: {
          lineCount: 1,
          quantity: 1,
          billedMinor: "700",
          taxMinor: "70",
          totalMinor: "770",
        },
      });
      await expectForbidden(f, route, f.C.doctor.cookie);
      await expectForbidden(f, route, f.desk.cookie);
      await expectForbidden(f, route, f.branch.cookie, `branchId=${f.C.branchD}`);
      await expectForbidden(f, route, f.C.admin.cookie, `branchId=${f.other.branchD}`);
    }
  });

  it("uses English service, tax and no-doctor labels for an English caller", async () => {
    const { h, C } = f;
    await h.owner`UPDATE memberships SET preferred_language = 'en' WHERE id = ${C.admin.memberId}`;
    await f.invalidate.clinicChanged(C.clinicId);
    try {
      const service = reports.reportByServiceResponseSchema.parse(
        (await f.get("by-service")).json(),
      );
      expect(service.rows.find((row) => row.kind === "service")?.name).toBe("Report service");
      expect(service.rows.find((row) => row.kind === "tax")?.name).toBe("Tax");
      const doctor = reports.reportByDoctorResponseSchema.parse((await f.get("by-doctor")).json());
      expect(doctor.rows.find((row) => row.kind === "none")?.name).toBe("No doctor");
    } finally {
      await h.owner`UPDATE memberships SET preferred_language = 'ar' WHERE id = ${C.admin.memberId}`;
      await f.invalidate.clinicChanged(C.clinicId);
    }
  });

  it("the finance feature guard refuses reports when disabled", async () => {
    const { h, C } = f;
    await h.owner`UPDATE clinic_features SET enabled = false
      WHERE clinic_id = ${C.clinicId} AND module = 'finance'`;
    await f.invalidate.clinicChanged(C.clinicId);
    try {
      const res = await send(
        h,
        C.admin.cookie,
        "GET",
        "/v1/finance-reports/by-service?from=2026-01-01&to=2026-12-31",
      );
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "module_disabled" });
    } finally {
      await h.owner`UPDATE clinic_features SET enabled = true
        WHERE clinic_id = ${C.clinicId} AND module = 'finance'`;
      await f.invalidate.clinicChanged(C.clinicId);
    }
  });
});
