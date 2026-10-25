import { describe, expect, it } from "vitest";

import { apiErrorCodeSchema, FINANCE_F2_ERROR_CODES, webErrorCodeSchema } from "../common.ts";
import {
  financeSettingsSchema,
  invoiceListItemSchema,
  invoiceListQuerySchema,
  invoiceSchema,
  invoiceSettlementSchema,
  PAYMENT_METHODS,
  platformFinanceTotalsSchema,
  voidInvoiceRequestSchema,
} from "../finance.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const invoice = {
  id: ID,
  number: "SLM-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: ID,
  branchNameAr: "فرع تجريبي",
  branchNameEn: "Synthetic branch",
  patientId: ID,
  issuedAt: "2026-10-20T08:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "1000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "1000",
  invoiceDiscount: null,
  lines: [],
  voidReason: null,
  voidedAt: null,
  version: 1,
};

describe("invoice settlement", () => {
  it.each([
    { state: "unpaid", paidMinor: "0", owedMinor: "1000" },
    { state: "partly_paid", paidMinor: "500", owedMinor: "500" },
    { state: "paid", paidMinor: "1000", owedMinor: "0" },
    { state: "paid", paidMinor: "0", owedMinor: "0" },
  ])("accepts matching state $state, paid $paidMinor and owed $owedMinor", (settlement) => {
    expect(invoiceSettlementSchema.parse(settlement)).toEqual(settlement);
  });

  it.each([
    { state: "unpaid", paidMinor: "1", owedMinor: "1" },
    { state: "unpaid", paidMinor: "0", owedMinor: "0" },
    { state: "partly_paid", paidMinor: "0", owedMinor: "1" },
    { state: "partly_paid", paidMinor: "1", owedMinor: "0" },
    { state: "paid", paidMinor: "1", owedMinor: "1" },
  ])("refuses mismatched state $state, paid $paidMinor and owed $owedMinor", (settlement) => {
    expect(invoiceSettlementSchema.safeParse(settlement).success).toBe(false);
  });

  it("inherits settlement on the invoice list item", () => {
    const { lines: _lines, ...item } = invoice;
    const settlement = { state: "unpaid", paidMinor: "0", owedMinor: "1000" };
    expect(
      invoiceListItemSchema.parse({ ...item, patientName: "Synthetic patient", settlement })
        .settlement,
    ).toEqual(settlement);
  });

  it("accepts null settlement on void invoices", () => {
    expect(
      invoiceSchema.parse({ ...invoice, status: "void", settlement: null }).settlement,
    ).toBeNull();
  });

  it("accepts the three settlement states as an invoice list filter and refuses any other", () => {
    for (const state of ["unpaid", "partly_paid", "paid"]) {
      expect(invoiceListQuerySchema.safeParse({ settlement: state }).success).toBe(true);
    }
    for (const state of ["credit", "void"]) {
      expect(invoiceListQuerySchema.safeParse({ settlement: state }).success).toBe(false);
    }
  });
});

describe("the invoice settlement agrees with the invoice status", () => {
  const settlement = { state: "unpaid", paidMinor: "0", owedMinor: "1000" };
  const { lines: _lines, ...item } = invoice;
  const listItem = { ...item, patientName: "Synthetic patient" };

  const refusals = [
    { status: "issued", settlement: null, label: "a null settlement" },
    { status: "void", settlement, label: "a settlement object" },
  ];
  const acceptances = [
    { status: "issued", settlement, label: "a settlement object" },
    { status: "void", settlement: null, label: "a null settlement" },
  ];

  it.each(refusals)("refuses $status invoices with $label", ({ status, settlement: value }) => {
    const detail = invoiceSchema.safeParse({ ...invoice, status, settlement: value });
    expect(detail.success).toBe(false);
    if (!detail.success) {
      expect(detail.error.issues[0]?.message).toBe("validation.invoiceSettlement");
      expect(detail.error.issues[0]?.path).toEqual(["settlement"]);
    }
    const item = invoiceListItemSchema.safeParse({ ...listItem, status, settlement: value });
    expect(item.success).toBe(false);
    if (!item.success) {
      expect(item.error.issues[0]?.message).toBe("validation.invoiceSettlement");
      expect(item.error.issues[0]?.path).toEqual(["settlement"]);
    }
  });

  it.each(acceptances)("accepts $status invoices with $label", ({ status, settlement: value }) => {
    expect(invoiceSchema.safeParse({ ...invoice, status, settlement: value }).success).toBe(true);
    expect(
      invoiceListItemSchema.safeParse({ ...listItem, status, settlement: value }).success,
    ).toBe(true);
  });

  it("refuses an issued invoice whose settlement does not add up to the total", () => {
    const value = { state: "partly_paid", paidMinor: "900", owedMinor: "900" };
    const detail = invoiceSchema.safeParse({ ...invoice, settlement: value });
    expect(detail.success).toBe(false);
    if (!detail.success) {
      expect(detail.error.issues[0]?.message).toBe("validation.invoiceSettlement");
      expect(detail.error.issues[0]?.path).toEqual(["settlement"]);
    }
    const item = invoiceListItemSchema.safeParse({ ...listItem, settlement: value });
    expect(item.success).toBe(false);
    if (!item.success) {
      expect(item.error.issues[0]?.message).toBe("validation.invoiceSettlement");
      expect(item.error.issues[0]?.path).toEqual(["settlement"]);
    }
  });

  it("accepts an issued invoice whose settlement adds up to the total", () => {
    const value = { state: "partly_paid", paidMinor: "400", owedMinor: "600" };
    expect(invoiceSchema.safeParse({ ...invoice, settlement: value }).success).toBe(true);
    expect(invoiceListItemSchema.safeParse({ ...listItem, settlement: value }).success).toBe(true);
  });

  it("keeps a total beyond the safe integers exact", () => {
    const totalMinor = "9007199254740993";
    const value = { state: "partly_paid", paidMinor: "9007199254740992", owedMinor: "1" };
    expect(invoiceSchema.safeParse({ ...invoice, totalMinor, settlement: value }).success).toBe(
      true,
    );
    expect(
      invoiceListItemSchema.safeParse({ ...listItem, totalMinor, settlement: value }).success,
    ).toBe(true);
  });
});

describe("the finance settings carry the complete payment method list", () => {
  const settings = {
    currency: "KWD",
    currencyExponent: 3,
    taxRateBp: 0,
    commercialRegNo: null,
    hasLogo: false,
  };
  const methods = PAYMENT_METHODS.map((method) => ({ method, enabled: true }));

  it("carries every method when the field is present", () => {
    expect(
      financeSettingsSchema.parse({ ...settings, paymentMethods: methods }).paymentMethods,
    ).toEqual(methods);
  });

  it("refuses a partial method list", () => {
    const result = financeSettingsSchema.safeParse({
      ...settings,
      paymentMethods: methods.slice(0, 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("validation.required");
  });

  it("refuses a repeated method", () => {
    const repeated = [methods[0], ...methods.slice(0, 3)];
    const result = financeSettingsSchema.safeParse({ ...settings, paymentMethods: repeated });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("validation.duplicate");
  });

  it("refuses an unknown method", () => {
    expect(
      financeSettingsSchema.safeParse({
        ...settings,
        paymentMethods: [{ method: "card", enabled: true }],
      }).success,
    ).toBe(false);
  });
});

describe("F1 response compatibility", () => {
  it("still accepts an invoice without settlement", () => {
    expect(invoiceSchema.parse(invoice)).toEqual(invoice);
  });

  it("still accepts finance settings without payment methods", () => {
    const settings = {
      currency: "KWD",
      currencyExponent: 3,
      taxRateBp: 0,
      commercialRegNo: null,
      hasLogo: false,
    };
    expect(financeSettingsSchema.parse(settings)).toEqual(settings);
  });

  it("still accepts monthly totals without collections or refunds", () => {
    const totals = { months: [{ month: "2026-10", currency: "KWD", invoicedMinor: "1000" }] };
    expect(platformFinanceTotalsSchema.parse(totals)).toEqual(totals);
  });

  it("accepts F2 aggregate amounts without patient details", () => {
    const totals = {
      months: [
        {
          month: "2026-10",
          currency: "KWD",
          invoicedMinor: "1000",
          collectedMinor: "500",
          refundedMinor: "0",
        },
      ],
    };
    expect(platformFinanceTotalsSchema.parse(totals)).toEqual(totals);
  });

  it.each(["collectedMinor", "refundedMinor"])(
    "requires canonical unsigned text for %s",
    (field) => {
      const month = { month: "2026-10", currency: "KWD", invoicedMinor: "1000", [field]: -1 };
      expect(platformFinanceTotalsSchema.safeParse({ months: [month] }).success).toBe(false);
    },
  );
});

describe("the finance error catalogue (F2 §4.6, F3 §4 and §7.4)", () => {
  const f2Codes = [
    "payment_method_disabled",
    "payment_exceeds_balance",
    "invoice_settled",
    "credit_insufficient",
    "refund_exceeds_available",
    "payment_methods_empty",
    "cash_drawer_changed",
    "invoice_paid_changed",
    "cash_closing_exists",
    "closing_note_required",
    "cash_drawer_out_of_range",
  ];
  const f3Codes = ["export_busy", "report_range_too_long", "export_amount_too_large"];

  it.each([...f2Codes, ...f3Codes])("includes API code %s", (code) => {
    expect(apiErrorCodeSchema.parse(code)).toBe(code);
  });

  it("the shared F2 list is the one the API and the web catalogue share", () => {
    expect([...FINANCE_F2_ERROR_CODES]).toEqual(f2Codes);
  });

  it.each(f2Codes)("includes web code %s: the web already has its message", (code) => {
    expect(webErrorCodeSchema.parse(code)).toBe(code);
  });

  const exportCodes = ["export_busy", "export_amount_too_large"];

  it.each(exportCodes)("leaves %s to the web's fallback until it ships", (code) => {
    expect(webErrorCodeSchema.safeParse(code).success).toBe(false);
  });

  it("carries report_range_too_long in the web catalogue: the web reports client reads it", () => {
    expect(webErrorCodeSchema.parse("report_range_too_long")).toBe("report_range_too_long");
  });

  it.each(["invoice_void", "version_conflict", "conflict", "not_implemented"])(
    "keeps the existing web code %s",
    (code) => {
      expect(webErrorCodeSchema.parse(code)).toBe(code);
    },
  );

  it("keeps API codes first and appends the two web-only codes", () => {
    expect(webErrorCodeSchema.options).toEqual([
      ...apiErrorCodeSchema.options.filter((code) => !exportCodes.includes(code)),
      "conflict",
      "not_implemented",
    ]);
  });
});

describe("the void request carries the paid amount the user confirmed", () => {
  const reason = "issued twice";

  it("accepts the request without it, so the web that is live today keeps working", () => {
    expect(voidInvoiceRequestSchema.parse({ reason })).toEqual({ reason });
  });

  it("accepts a canonical minor-unit string and refuses any other amount", () => {
    const accepted = { reason, expectedPaidMinor: "4000" };
    const refused = { reason, expectedPaidMinor: "-1" };
    expect(voidInvoiceRequestSchema.safeParse(accepted).success).toBe(true);
    expect(voidInvoiceRequestSchema.safeParse(refused).success).toBe(false);
  });
});
