import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, serviceAppointment, type FinanceClinic } from "./billing-fixtures.ts";

// Plan Task 8c (spec §8 rules 7–9, R1-7, R1-8, R1-14): one transaction from the source to the audit row,
// numbered without gaps per branch and clinic-timezone year.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
let patient: string;

type Issued = {
  invoice: {
    id: string;
    number: string;
    subtotalMinor: string;
    discountMinor: string;
    taxMinor: string;
    totalMinor: string;
    lines: { lineTotalMinor: string; descriptionEn: string }[];
    version: number;
  };
};

const free = (unitPriceMinor: string, discount: unknown = null) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount,
});
const manual = (lines: unknown[], invoiceDiscount: unknown = null, branchId = C.branchD) => ({
  source: "manual",
  sourceId: null,
  patientId: patient,
  branchId,
  lines,
  invoiceDiscount,
});
const issue = (cookie: string, body: unknown, key = randomUUID()) =>
  send(h, cookie, "POST", "/v1/invoices", body, key);
const seqOf = (res: { json: () => unknown }) =>
  Number((res.json() as Issued).invoice.number.split("-").at(-1));
const amount = (minor: string) => ({ kind: "amount", minor, reason: "courtesy" });
const pct = (bp: number) => ({ kind: "pct", bp, reason: "courtesy" });

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await h.owner`UPDATE branches SET invoice_prefix = 'SLMD' WHERE id = ${C.branchD}`;
  await h.owner`UPDATE branches SET invoice_prefix = 'SLMR' WHERE id = ${C.branchR}`;
  patient = await patientIn(h, C, C.branchD);
});

afterAll(() => closeHarness(h));

describe("totals through the API (spec §8b.1)", () => {
  it.each([
    ["E1", [free("500"), free("500")], amount("1"), 0, ["499", "500"], "999"],
    ["E4", [free("3"), free("4")], amount("1"), 1500, ["2", "4"], "7"],
    ["E5", [free("12345", pct(1000))], null, 0, ["11110"], "11110"],
  ])(
    "%s gives the same amounts as the shared function",
    async (_, lines, discount, tax, want, total) => {
      await h.owner`UPDATE clinics SET tax_rate_bp = ${tax} WHERE id = ${C.clinicId}`;
      try {
        const res = await issue(C.admin.cookie, manual(lines, discount));
        expect(res.statusCode).toBe(201);
        const { invoice } = res.json() as Issued;
        expect(invoice.lines.map((l) => l.lineTotalMinor)).toEqual(want);
        expect(invoice.totalMinor).toBe(total);
      } finally {
        await h.owner`UPDATE clinics SET tax_rate_bp = 0 WHERE id = ${C.clinicId}`;
      }
    },
  );

  it("E6: refuses an invoice discount on a zero sum", async () => {
    const res = await issue(C.admin.cookie, manual([free("0"), free("0")], amount("1")));
    expect([res.statusCode, code(res)]).toEqual([422, "discount_exceeds_total"]);
  });
});

describe("issue", () => {
  it("answers 201 with the branch number, the clinic year and an ETag of version 1", async () => {
    const res = await issue(C.admin.cookie, manual([free("1000")]));
    expect(res.statusCode).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect((res.json() as Issued).invoice.number).toMatch(/^SLMD-2026-\d{6}$/);
  });

  it("gives two concurrent issues in one branch consecutive numbers", async () => {
    const [a, b] = await Promise.all([
      issue(C.admin.cookie, manual([free("100")])),
      issue(C.admin.cookie, manual([free("200")])),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(Math.abs(seqOf(a) - seqOf(b))).toBe(1);
  });

  it("leaves no gap after an issue that fails once its number is taken", async () => {
    const before = seqOf(await issue(C.admin.cookie, manual([free("100")])));
    const unknownDoctor = {
      kind: "service",
      serviceId: C.serviceId,
      providerId: randomUUID(),
      quantity: 1,
      unitPriceMinor: "100",
      discount: null,
    };
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "100",
    });
    const failed = await issue(C.admin.cookie, manual([unknownDoctor]));
    expect([failed.statusCode, code(failed)]).toEqual([400, "validation"]);
    expect(seqOf(await issue(C.admin.cookie, manual([free("100")])))).toBe(before + 1);
  });

  it("returns the first invoice on a replayed key without taking a number", async () => {
    const key = randomUUID();
    const first = await issue(C.admin.cookie, manual([free("300")]), key);
    const replay = await issue(C.admin.cookie, manual([free("300")]), key);
    expect((replay.json() as Issued).invoice.id).toBe((first.json() as Issued).invoice.id);
    expect(seqOf(await issue(C.admin.cookie, manual([free("100")])))).toBe(seqOf(first) + 1);
  });

  it("refuses a second live invoice for the same appointment", async () => {
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "15000",
    });
    const appointment = await serviceAppointment(h, C, patient, "15:00");
    const body = {
      source: "appointment",
      sourceId: appointment,
      patientId: null,
      branchId: null,
      lines: [free("15000")],
      invoiceDiscount: null,
    };
    expect((await issue(C.admin.cookie, body)).statusCode).toBe(201);
    const again = await issue(C.admin.cookie, body);
    expect([again.statusCode, code(again)]).toEqual([409, "invoice_already_exists"]);
  });

  it("copies the service's names onto a service line", async () => {
    const res = await issue(
      C.admin.cookie,
      manual([
        {
          kind: "service",
          serviceId: C.serviceId,
          providerId: C.doctor.memberId,
          quantity: 1,
          unitPriceMinor: "15000",
          discount: null,
        },
      ]),
    );
    expect((res.json() as Issued).invoice.lines[0]!.descriptionEn).toMatch(/^Visit /);
  });
});

describe("issue refusals", () => {
  it("refuses a service line whose service has no price", async () => {
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: null,
    });
    await send(h, C.admin.cookie, "PUT", `/v1/services/${C.serviceId}/provider-prices`, {
      items: [],
    });
    const line = {
      kind: "service",
      serviceId: C.serviceId,
      providerId: null,
      quantity: 1,
      unitPriceMinor: "100",
      discount: null,
    };
    const res = await issue(C.admin.cookie, manual([line]));
    expect([res.statusCode, code(res)]).toEqual([422, "price_missing"]);
  });

  it("refuses a branch with no invoice prefix yet", async () => {
    const res = await issue(C.admin.cookie, manual([free("100")], null, C.branchX));
    expect([res.statusCode, code(res)]).toEqual([409, "invoice_prefix_missing"]);
  });

  it("refuses a doctor, who may only view the invoices of their own patients", async () => {
    const res = await issue(C.doctor.cookie, manual([free("100")]));
    expect(res.statusCode).toBe(403);
  });

  it("is not_found for a desk outside the invoice's branch", async () => {
    const res = await issue(C.desk.cookie, manual([free("100")]));
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });

  it("refuses a discount from a member without a discount key (R1-14)", async () => {
    const deskPatient = await patientIn(h, C, C.branchR);
    const res = await issue(C.desk.cookie, {
      ...manual([free("100", pct(1000))], null, C.branchR),
      patientId: deskPatient,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("issue audit (plan Task 8j)", () => {
  it("stores the amounts and the number exactly, and no free text", async () => {
    const since = new Date();
    const res = await issue(C.admin.cookie, {
      ...manual([{ ...free("1000000"), descriptionEn: "Mariam Al-Sabah session" }]),
    });
    const { invoice } = res.json() as Issued;
    const [row] = await h.owner`SELECT category, entity_type, details FROM audit_log
                                WHERE clinic_id = ${C.clinicId} AND entity_id = ${invoice.id}
                                  AND created_at >= ${since}`;
    expect(row).toMatchObject({
      category: "patient_access",
      entity_type: "invoice",
      details: { after: { number: invoice.number, subtotalMinor: "1000000" } },
    });
    expect(JSON.stringify(row!["details"])).not.toContain("Mariam");
  });
});
