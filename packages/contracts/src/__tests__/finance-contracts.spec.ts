import { describe, expect, it } from "vitest";

import {
  createInvoiceRequestSchema,
  invoiceDiscountInputSchema,
  invoiceLineInputSchema,
  invoiceListQuerySchema,
  invoicePrefixSchema,
  platformClinicFinanceRequestSchema,
  providerPricesRequestSchema,
  sendInvoiceRequestSchema,
} from "../finance.ts";
import { currencyCodeSchema } from "../money.ts";
import { createClinicRequestSchema } from "../onboarding.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const ID2 = "0198f0a0-0000-7000-8000-000000000002";
const line = {
  kind: "free",
  descriptionAr: "استشارة",
  descriptionEn: "Consultation",
  quantity: 1,
  unitPriceMinor: "15000",
  discount: null,
} as const;
const manual = {
  source: "manual",
  sourceId: null,
  patientId: ID,
  branchId: ID2,
  lines: [line],
  invoiceDiscount: null,
} as const;
const ok = (over: object) => createInvoiceRequestSchema.safeParse({ ...manual, ...over }).success;

describe("createInvoiceRequestSchema (R1-7)", () => {
  it("takes a manual invoice that names its patient and branch", () => {
    expect(ok({})).toBe(true);
  });

  it("refuses a manual invoice with a source id or without its patient or branch", () => {
    expect(ok({ sourceId: ID })).toBe(false);
    expect(ok({ patientId: null })).toBe(false);
    expect(ok({ branchId: null })).toBe(false);
  });

  it("takes an appointment invoice by its source only and refuses a sent patient or branch", () => {
    const fromSource = { source: "appointment", sourceId: ID, patientId: null, branchId: null };
    expect(ok(fromSource)).toBe(true);
    expect(ok({ ...fromSource, patientId: ID })).toBe(false);
    expect(ok({ ...fromSource, branchId: ID2 })).toBe(false);
    expect(ok({ ...fromSource, sourceId: null })).toBe(false);
  });

  it("needs 1 to 50 lines", () => {
    expect(ok({ lines: [] })).toBe(false);
    expect(ok({ lines: Array.from({ length: 50 }, () => line) })).toBe(true);
    expect(ok({ lines: Array.from({ length: 51 }, () => line) })).toBe(false);
  });
});

describe("invoice lines", () => {
  const parse = (over: object) => invoiceLineInputSchema.safeParse({ ...line, ...over }).success;

  it("keep the quantity between 1 and 999", () => {
    expect(parse({ quantity: 0 })).toBe(false);
    expect(parse({ quantity: 999 })).toBe(true);
    expect(parse({ quantity: 1000 })).toBe(false);
  });

  it("cap a line price at 10¹² minor units", () => {
    expect(parse({ unitPriceMinor: "1000000000000" })).toBe(true);
    expect(parse({ unitPriceMinor: "1000000000001" })).toBe(false);
  });

  it("refuse a free line without both descriptions", () => {
    expect(parse({ descriptionAr: "  " })).toBe(false);
  });
});

describe("discounts (FIN-A7)", () => {
  it("need a written reason and a percentage of at most 100 %", () => {
    const pct = (bp: number, reason: string) =>
      invoiceDiscountInputSchema.safeParse({ kind: "pct", bp, reason }).success;
    expect(pct(10000, "staff")).toBe(true);
    expect(pct(10001, "staff")).toBe(false);
    expect(pct(500, " ")).toBe(false);
  });

  it("cap a line discount at the line cap and an invoice discount at the bigint ceiling", () => {
    const big = { kind: "amount", minor: "1500000000000", reason: "goodwill" };
    expect(invoiceDiscountInputSchema.safeParse(big).success).toBe(true);
    const lineDiscount = { kind: "amount", minor: "1000000000001", reason: "goodwill" };
    expect(invoiceLineInputSchema.safeParse({ ...line, discount: lineDiscount }).success).toBe(
      false,
    );
  });
});

describe("the invoice list", () => {
  it("finds the live invoice of a source, but a source id alone names nothing", () => {
    const byAppointment = { source: "appointment", sourceId: ID };
    expect(invoiceListQuerySchema.safeParse(byAppointment).success).toBe(true);
    expect(invoiceListQuerySchema.safeParse({ sourceId: ID }).success).toBe(false);
  });
});

describe("prices, prefixes, sending and the platform", () => {
  it("allow one price per doctor only", () => {
    const item = { memberId: ID, priceMinor: "1000" };
    expect(providerPricesRequestSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(providerPricesRequestSchema.safeParse({ items: [item, item] }).success).toBe(false);
  });

  it("keep an invoice prefix to 2–6 upper-case letters or digits", () => {
    expect(invoicePrefixSchema.safeParse("KW1").success).toBe(true);
    expect(invoicePrefixSchema.safeParse("k").success).toBe(false);
    expect(invoicePrefixSchema.safeParse("ABCDEFG").success).toBe(false);
  });

  it("need a send request id with the channel (R2-5)", () => {
    expect(sendInvoiceRequestSchema.safeParse({ channel: "email" }).success).toBe(false);
    expect(
      sendInvoiceRequestSchema.safeParse({ channel: "whatsapp", sendRequestId: ID }).success,
    ).toBe(true);
  });

  it("change a supported currency or the tax rate, never neither", () => {
    expect(platformClinicFinanceRequestSchema.safeParse({}).success).toBe(false);
    expect(platformClinicFinanceRequestSchema.safeParse({ currency: "SAR" }).success).toBe(true);
    expect(platformClinicFinanceRequestSchema.safeParse({ currency: "USD" }).success).toBe(false);
    expect(platformClinicFinanceRequestSchema.safeParse({ taxRateBp: 10001 }).success).toBe(false);
  });
});

describe("the create-clinic currency (spec §8 rule 6)", () => {
  it("offers exactly the supported currencies, which onboarding.ts repeats inline", () => {
    const currency = createClinicRequestSchema.innerType().shape.currency.unwrap();
    expect(currency.options).toEqual(currencyCodeSchema.options);
  });
});
