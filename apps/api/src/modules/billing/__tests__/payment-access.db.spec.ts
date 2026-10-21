import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn, setModule } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  manualInvoice,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 (spec §4.8): who may record a payment and who may read the receipts — the keys, the
// branch scope, another clinic's rows and the finance module off.
let h: Harness;
let C: FinanceClinic;
let C2: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type Answer = { payment: { id: string; receiptNumber: string } };

const cash = (amountMinor: string) => ({ method: "cash", amountMinor });
const invoiceOn = async (clinic: FinanceClinic, branchId: string, total: string) =>
  manualInvoice(h, clinic.admin.cookie, await patientIn(h, clinic, branchId), branchId, total);

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  C2 = await financeClinic(h, invalidate);
  await setPrefixes(h, C2);
});

afterAll(() => closeHarness(h));

describe("a member without the payments key", () => {
  it("refuses the desk a payment and the receipts of an invoice", async () => {
    const invoice = await invoiceOn(C, C.branchR, "1000");
    const recorded = await pay(h, C.desk.cookie, invoice.id, cash("1000"));
    expect([recorded.statusCode, code(recorded)]).toEqual([403, "forbidden"]);
    const receipts = await send(h, C.desk.cookie, "GET", `/v1/invoices/${invoice.id}/payments`);
    expect([receipts.statusCode, code(receipts)]).toEqual([403, "forbidden"]);
  });
});

describe("the branch scope of a payment", () => {
  it("hides another branch's invoice and receipt from the receptionist of branch R", async () => {
    const invoice = await invoiceOn(C, C.branchD, "1000");
    const recorded = await pay(h, C.receptionist.cookie, invoice.id, cash("1000"));
    expect([recorded.statusCode, code(recorded)]).toEqual([404, "not_found"]);
    const receipts = await send(
      h,
      C.receptionist.cookie,
      "GET",
      `/v1/invoices/${invoice.id}/payments`,
    );
    expect([receipts.statusCode, code(receipts)]).toEqual([404, "not_found"]);
    const payment = await pay(h, C.admin.cookie, invoice.id, cash("1000"));
    expect(payment.statusCode, payment.body).toBe(201);
    const id = (payment.json() as Answer).payment.id;
    const receipt = await send(h, C.receptionist.cookie, "GET", `/v1/payments/${id}`);
    expect([receipt.statusCode, code(receipt)]).toEqual([404, "not_found"]);
  });

  it("lets the receptionist pay the invoice of its own branch", async () => {
    const invoice = await invoiceOn(C, C.branchR, "1000");
    const recorded = await pay(h, C.receptionist.cookie, invoice.id, cash("1000"));
    expect(recorded.statusCode, recorded.body).toBe(201);
  });
});

describe("a doctor with view:invoices:own", () => {
  it("shows the settlement of their own patient's invoice but not the receipts", async () => {
    const patient = await patientIn(h, C, C.branchD);
    // A visit of the doctor makes the file theirs (R1-12), so the invoice of that file is theirs too.
    await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
                    status, started_at, created_at, updated_at)
                  VALUES (${C.clinicId}, ${randomUUID()}, ${C.branchD}, ${patient},
                    ${C.doctor.memberId}, 'draft', now(), now(), now())`;
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const shown = await send(h, C.doctor.cookie, "GET", `/v1/invoices/${invoice.id}`);
    expect(shown.statusCode, shown.body).toBe(200);
    expect((shown.json() as { invoice: { settlement: unknown } }).invoice.settlement).toEqual({
      state: "unpaid",
      paidMinor: "0",
      owedMinor: "1000",
    });
    const receipts = await send(h, C.doctor.cookie, "GET", `/v1/invoices/${invoice.id}/payments`);
    expect([receipts.statusCode, code(receipts)]).toEqual([403, "forbidden"]);
  });
});

describe("another clinic's money", () => {
  it("hides the first clinic's invoice and receipt from the second clinic's admin", async () => {
    const invoice = await invoiceOn(C, C.branchD, "1000");
    const recorded = await pay(h, C2.admin.cookie, invoice.id, cash("1000"));
    expect([recorded.statusCode, code(recorded)]).toEqual([404, "not_found"]);
    const payment = await pay(h, C.admin.cookie, invoice.id, cash("1000"));
    expect(payment.statusCode, payment.body).toBe(201);
    const id = (payment.json() as Answer).payment.id;
    const receipt = await send(h, C2.admin.cookie, "GET", `/v1/payments/${id}`);
    expect([receipt.statusCode, code(receipt)]).toEqual([404, "not_found"]);
  });
});

describe("the finance module off", () => {
  it("refuses a payment with module_disabled", async () => {
    const invoice = await invoiceOn(C2, C2.branchD, "1000");
    await setModule(h, invalidate, C2.clinicId, "finance", false);
    try {
      const recorded = await pay(h, C2.admin.cookie, invoice.id, cash("1000"));
      expect([recorded.statusCode, code(recorded)]).toEqual([403, "module_disabled"]);
    } finally {
      await setModule(h, invalidate, C2.clinicId, "finance", true);
    }
  });
});
