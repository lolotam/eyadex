import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import { invoicePdfModel } from "../index.ts";
const header = {
  clinicAr: "عيادة تجريبية",
  clinicEn: "Synthetic Clinic",
  timezone: "Asia/Kuwait",
  address: null,
  phone: null,
  commercialRegNo: null,
};
const invoice: Invoice = {
  id: "INTERNAL-INVOICE",
  number: "SYN-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: "INTERNAL-BRANCH",
  branchNameAr: "فرع تجريبي",
  branchNameEn: "Synthetic Branch",
  patientId: "INTERNAL-PATIENT",
  issuedAt: "2026-01-01T22:30:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "9223372036854775807",
  discountMinor: "1",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "7",
  invoiceDiscount: null,
  lines: [
    {
      position: 0,
      kind: "free",
      serviceId: null,
      providerId: "INTERNAL-PROVIDER",
      descriptionAr: "فحص تجريبي",
      descriptionEn: "Synthetic examination",
      quantity: 2,
      unitPriceMinor: "500",
      discount: { kind: "pct", bp: 125, reason: "سبب تجريبي" },
      lineTotalMinor: "499",
    },
  ],
  voidReason: null,
  voidedAt: null,
  version: 3,
};

describe("pre-extraction model fixtures", () => {
  it("preserves exact outputs across currencies, discounts and void facts", () => {
    const models = Object.entries(SUPPORTED_CURRENCIES).flatMap(([currency, exponent]) =>
      [
        null,
        { kind: "amount", minor: "1234", reason: invoice.lines[0]!.discount!.reason },
        { kind: "pct", bp: 125, reason: "Synthetic reason" },
      ].flatMap((discount) =>
        [false, true].map((voided) =>
          invoicePdfModel(
            {
              ...invoice,
              currency: currency as Invoice["currency"],
              currencyExponent: exponent,
              invoiceDiscount: discount as Invoice["invoiceDiscount"],
              lines: [{ ...invoice.lines[0]!, discount: discount as Invoice["invoiceDiscount"] }],
              taxMinor: "2",
              status: voided ? "void" : "issued",
              voidReason: voided ? "Synthetic void" : null,
              voidedAt: voided ? invoice.issuedAt : null,
            },
            {
              ...header,
              address: "Synthetic address",
              phone: "SYNTHETIC-PHONE",
              commercialRegNo: "SYNTHETIC-REG",
            },
            header.clinicAr,
          ),
        ),
      ),
    );
    expect(models).toHaveLength(36);
    // Golden digest captured from parent 0d0eb237; covers the complete serialized models.
    const digest = createHash("sha256").update(JSON.stringify(models)).digest("hex");
    expect(digest).toBe("b1fcc75312053310bdedceb3931497a45bce5b3990ed0a3087ac6c3d70a0eb98");
  });
});
