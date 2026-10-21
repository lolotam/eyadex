import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  manualInvoice,
  pay,
  refund,
  setPrefixes,
} from "../../billing/__tests__/billing-fixtures.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { platformStaff } from "./platform-staff.ts";

// Plan Task 8i (spec §8 rule 6, FIN-3): the platform sets a clinic's currency and tax rate, and reads
// monthly totals through finance_monthly_totals only.
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
let invalidate: AuthorizationInvalidator;

const platform = (method: "GET" | "PATCH" | "POST", url: string, body?: unknown, key?: string) =>
  call(h, {
    method,
    url: `/v1/platform/clinics${url}`,
    host: PLATFORM,
    cookie: staff.cookie,
    ...(body === undefined ? {} : { body }),
    ...(key === undefined ? {} : { headers: { "idempotency-key": key } }),
  });
const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
});

afterAll(() => closeHarness(h));

describe("a new clinic's currency (spec §8 rule 6)", () => {
  it("is stored with its derived exponent and the tax rate the form sent", async () => {
    const tag = randomUUID().slice(0, 8);
    const created = await platform(
      "POST",
      "",
      {
        nameAr: "عيادة",
        nameEn: "Clinic",
        slug: `fin-${tag}`,
        specialty: "general",
        defaultLanguage: "ar",
        timezone: "Asia/Kuwait",
        status: "trial",
        expiresAt: "2099-01-01T00:00:00Z",
        maxUsers: 5,
        maxBranches: 2,
        modules: { patients: true, appointments: true, medical: false, finance: true },
        currency: "SAR",
        taxRateBp: 1500,
        admin: { fullName: "Admin", email: `admin-${tag}@example.test` },
      },
      randomUUID(),
    );
    expect(created.statusCode).toBe(201);
    const clinicId = (created.json() as { clinicId: string }).clinicId;
    const res = await platform("GET", `/${clinicId}/finance`);
    expect(res.json()).toEqual({ currency: "SAR", currencyExponent: 2, taxRateBp: 1500 });
  });
});

describe("PATCH /v1/platform/clinics/:id/finance", () => {
  it("changes the currency while the clinic has no price or invoice, then locks it", async () => {
    const C = await financeClinic(h, invalidate);
    const changed = await platform("PATCH", `/${C.clinicId}/finance`, { currency: "BHD" });
    expect(changed.json()).toEqual({ currency: "BHD", currencyExponent: 3, taxRateBp: 0 });
    const [audit] = await h.owner`SELECT details FROM platform_audit_log
                                  WHERE clinic_id = ${C.clinicId} AND action = 'clinic.finance_changed'`;
    expect(audit!["details"]).toMatchObject({
      before: { currency: "KWD" },
      after: { currency: "BHD" },
    });
    // PR #77 review: the platform log's clinic allowlist dropped both fields, so the change showed as empty.
    const log = await call(h, {
      method: "GET",
      url: "/v1/platform/audit?action=clinic.finance_changed&limit=100",
      host: PLATFORM,
      cookie: staff.cookie,
    });
    expect(log.statusCode, log.body).toBe(200);
    const items = (log.json() as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i["clinicId"] === C.clinicId)).toMatchObject({
      before: { currency: "KWD", taxRateBp: 0 },
      after: { currency: "BHD", taxRateBp: 0 },
    });

    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "1000",
    });
    const locked = await platform("PATCH", `/${C.clinicId}/finance`, { currency: "KWD" });
    expect([locked.statusCode, code(locked)]).toEqual([409, "currency_locked"]);
    const tax = await platform("PATCH", `/${C.clinicId}/finance`, { taxRateBp: 500 });
    expect(tax.json()).toEqual({ currency: "BHD", currencyExponent: 3, taxRateBp: 500 });
  });

  it("answers not_found for no clinic", async () => {
    const res = await platform("PATCH", `/${randomUUID()}/finance`, { taxRateBp: 0 });
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });
});

describe("GET /v1/platform/clinics/:id/finance-totals (FIN-3)", () => {
  it("sums the month's live invoices and nothing else of them", async () => {
    const C = await financeClinic(h, invalidate);
    await setPrefixes(h, C);
    const patient = await patientIn(h, C, C.branchD);
    await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1500");
    await manualInvoice(h, C.admin.cookie, patient, C.branchD, "2500");
    const res = await platform("GET", `/${C.clinicId}/finance-totals`);
    expect(res.statusCode).toBe(200);
    const { months } = res.json() as { months: Record<string, unknown>[] };
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({
      currency: "KWD",
      invoicedMinor: "4000",
      collectedMinor: "0",
      refundedMinor: "0",
    });
    expect(Object.keys(months[0]!).sort()).toEqual([
      "collectedMinor",
      "currency",
      "invoicedMinor",
      "month",
      "refundedMinor",
    ]);
  });

  it("counts a payment by its month and a refund by its own month (R1-17)", async () => {
    const C = await financeClinic(h, invalidate);
    await setPrefixes(h, C);
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "3000");
    const paid = await pay(h, C.admin.cookie, invoice.id, { method: "knet", amountMinor: "3000" });
    expect(paid.statusCode, paid.body).toBe(201);
    const paymentId = (paid.json() as { payment: { id: string } }).payment.id;
    const clock = h.app.get<Clock>(CLOCK);
    const real = clock.now;
    // The refund is made 40 days later, so it lands in a later clinic month than the payment.
    clock.now = () => new Date(real().getTime() + 40 * 86_400_000);
    try {
      const refunded = await refund(h, C.admin.cookie, invoice.id, {
        source: "payment",
        paymentId,
        amountMinor: "1000",
        method: "knet",
        reason: "returned a service",
      });
      expect(refunded.statusCode, refunded.body).toBe(201);
    } finally {
      clock.now = real;
    }
    const res = await platform("GET", `/${C.clinicId}/finance-totals`);
    expect(res.statusCode).toBe(200);
    const { months } = res.json() as { months: Record<string, unknown>[] };
    expect(months).toHaveLength(2);
    expect(months[0]).toMatchObject({
      invoicedMinor: "3000",
      collectedMinor: "3000",
      refundedMinor: "0",
    });
    expect(months[1]).toMatchObject({
      invoicedMinor: "0",
      collectedMinor: "0",
      refundedMinor: "1000",
    });
    // Totals only: no row names a patient, an invoice or a payment.
    expect(res.body).not.toContain(patient);
    expect(res.body).not.toContain(invoice.id);
    expect(res.body).not.toContain(paymentId);
  });
});
