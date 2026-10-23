import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { errorCodeOf, errorKeyOf } from "@/shared/api/api-error";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

const admin = () => as("clinic_admin");

/** The error a call refuses with, or null when it does not refuse. */
async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

function manual(amount = "5000"): CreateInvoiceRequest {
  const clinicId = clinicIdAt(0);
  const patient = getState().patients.find((p) => p.clinicId === clinicId);
  if (!patient) throw new Error("seed");
  return {
    source: "manual",
    sourceId: null,
    patientId: patient.id,
    branchId: patient.registrationBranchId,
    lines: [
      {
        kind: "free",
        descriptionAr: "بند",
        descriptionEn: "Item",
        quantity: 1,
        unitPriceMinor: amount,
        discount: null,
      },
    ],
    invoiceDiscount: null,
  };
}

/** An issued invoice with a payment on it, as the screen reads it. */
async function paidInvoice(amount = "5000", paid = "1000") {
  const invoice = await api.finance.issue(admin(), manual(amount), crypto.randomUUID());
  await api.payments.recordPayment(
    admin(),
    invoice.id,
    { method: "cash", amountMinor: paid },
    crypto.randomUUID(),
  );
  return invoice;
}

beforeEach(() => resetMockData());

// Issue #113: the API refuses a void when the paid amount the user confirmed is not the invoice's paid
// amount any more, so money paid since that read never becomes the patient's credit unseen. The mock
// answers as the API does, under the lock and before any write.
describe("the mock voids as the API does", () => {
  it("NEGATIVE: refuses a void whose confirmed amount is stale, and writes nothing", async () => {
    const invoice = await paidInvoice();
    const audits = getState().clinicAudit.length;
    const error = await errorOf(api.finance.voidInvoice(admin(), invoice.id, 1, "خطأ", "0"));
    expect(errorKeyOf(error)).toBe("invoice_paid_changed");
    // The F2 code is outside the web catalogue: it travels inside `unknown`, as the HTTP adapter has it.
    expect(errorCodeOf(error)).toBe("unknown");
    // Nothing was written: the invoice is still issued and no audit row was added.
    expect((await api.finance.getInvoice(admin(), invoice.id)).status).toBe("issued");
    expect(getState().clinicAudit.length).toBe(audits);
  });

  it("accepts the void with the amount the invoice carries", async () => {
    const invoice = await paidInvoice();
    const voided = await api.finance.voidInvoice(admin(), invoice.id, 1, "خطأ", "1000");
    expect(voided.status).toBe("void");
  });

  it("accepts a void that carries no amount", async () => {
    const invoice = await paidInvoice();
    const voided = await api.finance.voidInvoice(admin(), invoice.id, 1, "خطأ");
    expect(voided.status).toBe("void");
  });

  it("NEGATIVE: a stale version is still version_conflict, decided before the amount", async () => {
    const invoice = await paidInvoice();
    const error = await errorOf(api.finance.voidInvoice(admin(), invoice.id, 9, "خطأ", "0"));
    expect(errorKeyOf(error)).toBe("version_conflict");
  });
});
