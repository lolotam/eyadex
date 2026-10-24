import { randomUUID } from "node:crypto";

import { invoiceWriteResponseSchema } from "@eyadex/contracts/finance";
import { expect } from "vitest";

import { openHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { financeClinic, namedPatient, setPrefixes } from "./billing-fixtures.ts";

export const RANGE = "from=2026-01-01&to=2026-12-31";
export const REPORT_ROUTES = [
  "daily-takings",
  "period-summary",
  "by-service",
  "by-doctor",
  "outstanding",
  "patient-credit",
  "refunds",
  "discounts",
  "cash-closings",
  "own-summary",
] as const;

export async function reportFixture() {
  const h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  const C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  const other = await financeClinic(h, invalidate);
  await setPrefixes(h, other);
  const branch = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, [
      "view:report_takings:branch",
      "view:report_analytics:branch",
      "view:report_patients:branch",
      "view:invoices:branch",
      "view:payments:branch",
      "view:cash_closings:branch",
    ]),
    { allBranches: false, branchIds: [C.branchR] },
  );
  const desk = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, [
      "view:report_takings:branch",
      "view:invoices:branch",
      "view:payments:branch",
      "view:cash_closings:branch",
    ]),
    { allBranches: false, branchIds: [C.branchR] },
  );
  await invalidate.clinicChanged(C.clinicId);
  const patientD = await namedPatient(h, C, C.branchD, "مراجع تقارير د");
  const patientR = await namedPatient(h, C, C.branchR, "مراجع تقارير ر");
  const get = (report: string, cookie = C.admin.cookie, extra = "", range = RANGE) =>
    send(h, cookie, "GET", `/v1/finance-reports/${report}?${range}${extra ? `&${extra}` : ""}`);
  return { h, C, other, invalidate, branch, desk, patientD, patientR, get };
}

export type ReportFixture = Awaited<ReturnType<typeof reportFixture>>;

export const reportFreeLine = (unitPriceMinor: string, discount: unknown = null) => ({
  kind: "free",
  descriptionAr: "جلسة تجريبية",
  descriptionEn: "Sample session",
  quantity: 1,
  unitPriceMinor,
  discount,
});

export async function issueReportInvoice(
  f: ReportFixture,
  patientId: string,
  branchId: string,
  lines: unknown[],
  invoiceDiscount: unknown = null,
  day = "2026-06-15",
  clinic = f.C,
) {
  const res = await send(
    f.h,
    clinic.admin.cookie,
    "POST",
    "/v1/invoices",
    {
      source: "manual",
      sourceId: null,
      patientId,
      branchId,
      lines,
      invoiceDiscount,
    },
    randomUUID(),
  );
  expect(res.statusCode, res.body).toBe(201);
  const invoice = invoiceWriteResponseSchema.parse(res.json()).invoice;
  await f.h.owner`UPDATE invoices SET issued_at = ${`${day}T09:00:00Z`}::timestamptz
    WHERE clinic_id = ${clinic.clinicId} AND id = ${invoice.id}`;
  return invoice;
}

export async function foreignInvoice(f: ReportFixture) {
  const patient = await namedPatient(f.h, f.other, f.other.branchD, "مراجع عيادة أخرى");
  return issueReportInvoice(
    f,
    patient,
    f.other.branchD,
    [reportFreeLine("999999")],
    null,
    "2026-06-15",
    f.other,
  );
}

export async function expectForbidden(
  f: ReportFixture,
  report: string,
  cookie: string,
  extra = "",
) {
  const res = await f.get(report, cookie, extra);
  expect([res.statusCode, code(res)], res.body).toEqual([403, "forbidden"]);
}

export async function reportNames(f: ReportFixture, membershipId: string) {
  const [row] = await f.h.owner`SELECT full_name FROM memberships
    WHERE clinic_id = ${f.C.clinicId} AND id = ${membershipId}`;
  return row!["full_name"] as string;
}
