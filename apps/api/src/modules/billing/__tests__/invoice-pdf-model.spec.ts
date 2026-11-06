import { describe, expect, it } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import { invoicePdfModel } from "../domain/invoice-pdf-model.ts";

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

describe("invoice PDF model", () => {
  it("copies stored amounts exactly without recomputing inconsistent totals", () => {
    const model = invoicePdfModel(invoice, header, "مراجع تجريبي");
    expect(model.totals).toEqual([
      { ar: "المجموع الفرعي", en: "Subtotal", value: "9223372036854775.807" },
      { ar: "الخصم", en: "Discount", value: "0.001" },
      { ar: "الإجمالي", en: "Total", value: "0.007" },
    ]);
    expect(model.lines[0]).toMatchObject({ unitPrice: "0.500", total: "0.499", discount: "1.25%" });
    expect(model.dateEn).toBe("2 January 2026");
    expect(model.dateAr).toBe(
      new Intl.DateTimeFormat("ar-KW", {
        dateStyle: "long",
        timeZone: "Asia/Kuwait",
      }).format(new Date(invoice.issuedAt)),
    );
  });

  it("allows only named print fields even when source objects carry extra private data", () => {
    const source = { ...invoice, privateNote: "PRIVATE-NOTE" };
    const clinic = { ...header, privatePhone: "PRIVATE-PHONE" };
    const model = invoicePdfModel(source, clinic, "مراجع تجريبي");
    const serialized = JSON.stringify(model);
    for (const marker of ["INTERNAL-", "PRIVATE-", "patientId", "sourceId", "providerId"]) {
      expect(serialized).not.toContain(marker);
    }
    expect(model.patientName).toBe("مراجع تجريبي");
    expect(model.header).toHaveLength(1);
  });

  it.each(Object.entries(SUPPORTED_CURRENCIES))(
    "formats the stored %s exponent",
    (currency, exponent) => {
      const model = invoicePdfModel(
        { ...invoice, currency: currency as Invoice["currency"], currencyExponent: exponent },
        header,
        "Synthetic Patient",
      );
      expect(model.lines[0]!.unitPrice).toBe(exponent === 3 ? "0.500" : "5.00");
      expect(model.currencyEn).toBe(currency);
      expect(model.currencyAr).not.toContain(".");
    },
  );

  it("preserves all 50 long descriptions and reasons, and the void banner facts", () => {
    const reason = "سبب ".repeat(500).trim();
    const line = {
      ...invoice.lines[0]!,
      descriptionAr: "وصف ".repeat(500).trim(),
      discount: { kind: "amount" as const, minor: "1", reason },
    };
    const model = invoicePdfModel(
      {
        ...invoice,
        status: "void",
        voidReason: reason,
        voidedAt: invoice.issuedAt,
        taxMinor: "2",
        lines: Array.from({ length: 50 }, (_, position) => ({ ...line, position })),
      },
      header,
      "Synthetic Patient",
    );
    expect(model.lines).toHaveLength(50);
    expect(model.lines[49]).toMatchObject({
      position: "50",
      descriptionAr: line.descriptionAr,
      discountReason: reason,
      discount: "0.001",
    });
    expect(model.voidReason).toBe(reason);
    expect(model.voidDateEn).toBe("2 January 2026");
    expect(model.totals[2]).toMatchObject({ en: "Tax", value: "0.002" });
  });

  it.each(["\n", "\t", "\u202e"])(
    "refuses unsupported control characters rather than dropping them: %j",
    (control) => {
      expect(() => invoicePdfModel(invoice, header, `Synthetic${control}Patient`)).toThrow(
        "pdf_model_invalid",
      );
    },
  );

  it("refuses a missing display name and an inconsistent currency exponent", () => {
    expect(() => invoicePdfModel(invoice, header, " ")).toThrow("pdf_model_invalid");
    expect(() =>
      invoicePdfModel({ ...invoice, currencyExponent: 2 }, header, "Synthetic Patient"),
    ).toThrow("pdf_model_invalid");
  });

  it("refuses incomplete void facts and more than the permitted 50 lines", () => {
    expect(() =>
      invoicePdfModel({ ...invoice, status: "void" }, header, "Synthetic Patient"),
    ).toThrow("pdf_model_invalid");
    expect(() =>
      invoicePdfModel(
        { ...invoice, lines: Array.from({ length: 51 }, () => invoice.lines[0]!) },
        header,
        "Synthetic Patient",
      ),
    ).toThrow("pdf_model_invalid");
  });
});
