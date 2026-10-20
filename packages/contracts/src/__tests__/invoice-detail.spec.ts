import { describe, expect, it } from "vitest";

import {
  invoiceListItemSchema,
  invoiceListResponseSchema,
  invoiceObjectSchema,
} from "../finance.ts";

const item = {
  id: "0190a000-0000-7000-8000-000000000001",
  number: "TEST-2026-0001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: "0190a000-0000-7000-8000-000000000002",
  branchNameAr: "فرع تجريبي",
  branchNameEn: "Test branch",
  patientId: "0190a000-0000-7000-8000-000000000003",
  issuedAt: "2026-10-16T09:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "1000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "1000",
  invoiceDiscount: null,
  voidReason: null,
  voidedAt: null,
  version: 1,
};

describe("the invoice detail patient label", () => {
  it("keeps the detail display name optional for older responses", () => {
    const schema = invoiceObjectSchema.pick({ patientName: true });
    expect(schema.parse({ patientName: "Example" })).toEqual({ patientName: "Example" });
    expect(schema.parse({})).toEqual({});
  });

  it("requires a patient name on every list item", () => {
    expect(invoiceListItemSchema.safeParse(item).success).toBe(false);
    const named = { ...item, patientName: "مراجع تجريبي" };
    expect(invoiceListItemSchema.parse(named)).toEqual(named);
    expect(invoiceListItemSchema.safeParse({ ...named, lines: [] }).success).toBe(false);
  });

  it("keeps the list response and its items strict", () => {
    const page = { items: [{ ...item, patientName: "مراجع تجريبي" }], nextCursor: null, total: 1 };
    expect(invoiceListResponseSchema.parse(page)).toEqual(page);
    expect(invoiceListResponseSchema.safeParse({ ...page, extra: true }).success).toBe(false);
    expect(invoiceListResponseSchema.safeParse({ ...page, items: [item] }).success).toBe(false);
    expect(
      invoiceListResponseSchema.safeParse({
        items: [{ ...page.items[0], extra: true }],
        nextCursor: null,
        total: 1,
      }).success,
    ).toBe(false);
  });
});
