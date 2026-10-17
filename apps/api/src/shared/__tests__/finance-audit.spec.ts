import type { Invoice } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { describe, expect, it } from "vitest";

import { invoiceAuditSnapshot, writeFinanceAudit } from "../finance-audit.ts";

const PATIENT_NAME = "Mariam Al-Sabah 99887766";

const invoice: Invoice = {
  id: "0199a000-0000-7000-8000-000000000001",
  number: "SLM-2026-000123",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: "0199a000-0000-7000-8000-000000000002",
  // A branch name is free text too, read with the invoice; it must not reach the snapshot either.
  branchNameAr: `فرع ${PATIENT_NAME}`,
  branchNameEn: `Branch ${PATIENT_NAME}`,
  patientId: "0199a000-0000-7000-8000-000000000003",
  issuedAt: "2026-10-15T09:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "1000000",
  discountMinor: "100000",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "900000",
  invoiceDiscount: { kind: "pct", bp: 1000, reason: `courtesy for ${PATIENT_NAME}` },
  lines: [
    {
      position: 0,
      kind: "free",
      serviceId: null,
      providerId: null,
      descriptionAr: `جلسة ${PATIENT_NAME}`,
      descriptionEn: `Session for ${PATIENT_NAME}`,
      quantity: 1,
      unitPriceMinor: "1000000",
      discount: { kind: "amount", minor: "0", reason: PATIENT_NAME },
      lineTotalMinor: "1000000",
    },
  ],
  voidReason: null,
  voidedAt: null,
  version: 2,
};

describe("finance audit snapshot (plan Task 8j)", () => {
  it("keeps amounts and the number exactly, which the generic audit scrub would mask", () => {
    expect(invoiceAuditSnapshot(invoice)).toEqual({
      number: "SLM-2026-000123",
      status: "issued",
      version: 2,
      subtotalMinor: "1000000",
      discountMinor: "100000",
      taxMinor: "0",
      totalMinor: "900000",
      lineCount: 1,
      discounts: [
        { scope: "line", kind: "amount", minor: "0" },
        { scope: "invoice", kind: "pct", bp: 1000 },
      ],
    });
  });

  it("never carries a line description or a discount reason, where a patient's name can sit", () => {
    expect(JSON.stringify(invoiceAuditSnapshot(invoice))).not.toContain("Mariam");
  });

  it("refuses a snapshot whose number is not an invoice number, before any SQL runs", async () => {
    const neverCalled = {
      execute: () => {
        throw new Error("the row must not be written");
      },
    } as unknown as Tx;
    const after = { ...invoiceAuditSnapshot(invoice), number: PATIENT_NAME };
    await expect(
      writeFinanceAudit(neverCalled, {
        clinicId: invoice.id,
        id: invoice.id,
        actorUserId: invoice.id,
        action: "invoice.issue",
        entityType: "invoice",
        entityId: invoice.id,
        branchId: invoice.branchId,
        before: null,
        after,
        createdAt: new Date(),
      }),
    ).rejects.toThrow("outside its shape");
  });
});
