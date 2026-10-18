import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { as, api, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { withoutDiscounts, type InvoiceFormValues } from "./invoice-form-draft";

beforeEach(() => resetMockData());

function discounted(): CreateInvoiceRequest {
  const patient = getState().patients.find((p) => p.clinicId === clinicIdAt(0));
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
        unitPriceMinor: "5000",
        discount: null,
      },
    ],
    invoiceDiscount: { kind: "pct", bp: 1000, reason: "r" },
  };
}

describe("discounts follow the invoice's branch", () => {
  it("NEGATIVE: the mock refuses a discount from a role without create:discounts there", async () => {
    // The seeded receptionist creates invoices in its branches but holds no discount key.
    await expect(
      api.finance.issue(as("receptionist"), discounted(), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) });
    expect(getState().clinicAudit.some((r) => r.action === "invoice.issued")).toBe(false);
  });

  it("a branch change out of the discount key's reach drops every discount", () => {
    const values: InvoiceFormValues = {
      patientId: "p",
      branchId: "b",
      lines: [{ discount: { kind: "pct", value: "10", reason: "r" } } as InvoiceFormValues["lines"][number]],
      invoiceDiscount: { kind: "amount", value: "1", reason: "r" },
    };
    const out = withoutDiscounts(values);
    expect(out.invoiceDiscount).toBeNull();
    expect(out.lines[0]?.discount).toBeNull();
  });
});
