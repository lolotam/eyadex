import type { Invoice } from "../finance-invoice.ts";
import { describe, expect, it } from "vitest";
import {
  assertInvoiceAuditSnapshotShape,
  invoiceAuditSnapshot,
} from "../finance-audit-snapshot.ts";

const PATIENT_NAME = "Sample private text";

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

describe("invoice audit snapshot", () => {
  it("keeps only allowed fields and exact amounts, excluding every free text field", () => {
    const snapshot = invoiceAuditSnapshot({ ...invoice, voidReason: PATIENT_NAME });
    expect(snapshot).toEqual({
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
    expect(JSON.stringify(snapshot)).not.toContain(PATIENT_NAME);
    expect(() => assertInvoiceAuditSnapshotShape(snapshot)).not.toThrow();
  });

  it("keeps scope and kind for percentage lines and amount invoice discounts too", () => {
    const snapshot = invoiceAuditSnapshot({
      ...invoice,
      lines: [{ ...invoice.lines[0]!, discount: { kind: "pct", bp: 500, reason: PATIENT_NAME } }],
      invoiceDiscount: { kind: "amount", minor: "12345678", reason: PATIENT_NAME },
    });
    expect(snapshot.discounts).toEqual([
      { scope: "line", kind: "pct", bp: 500 },
      { scope: "invoice", kind: "amount", minor: "12345678" },
    ]);
    expect(() => assertInvoiceAuditSnapshotShape(snapshot)).not.toThrow();
  });

  it("omits absent discounts and permits an absent before snapshot", () => {
    expect(
      invoiceAuditSnapshot({ ...invoice, lines: [], invoiceDiscount: null }).discounts,
    ).toEqual([]);
    expect(() => assertInvoiceAuditSnapshotShape(null)).not.toThrow();
  });

  it.each([
    { number: PATIENT_NAME },
    { subtotalMinor: "-1" },
    { discountMinor: "1.0" },
    { taxMinor: "12345678901234567890" },
    { totalMinor: PATIENT_NAME },
    { discounts: [{ scope: "line", kind: "amount", minor: PATIENT_NAME }] },
    { discounts: [{ scope: "invoice", kind: "amount", minor: "-1" }] },
  ] as const)("rejects values outside the allowed string shapes: %j", (invalid) => {
    expect(() =>
      assertInvoiceAuditSnapshotShape({ ...invoiceAuditSnapshot(invoice), ...invalid }),
    ).toThrow("finance audit snapshot holds a value outside its shape");
  });
});
