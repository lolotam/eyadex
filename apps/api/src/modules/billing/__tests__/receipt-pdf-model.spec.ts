import { describe, expect, it } from "vitest";
import type { Payment } from "@eyadex/contracts/finance";
import { receiptPdfModel } from "../domain/receipt-pdf-model.ts";

const payment: Payment = {
  id: "INTERNAL-PAYMENT",
  receiptNumber: "SYN-R-2026-000001",
  branchId: "INTERNAL-BRANCH",
  invoiceId: "INTERNAL-INVOICE",
  invoiceNumber: "IGNORED-INVOICE-NUMBER",
  patientId: "INTERNAL-PATIENT",
  patientName: "IGNORED-PATIENT-NAME",
  method: "cash",
  amountMinor: "9223372036854775807",
  currency: "KWD",
  currencyExponent: 3,
  reference: null,
  receivedAt: "2026-01-01T22:30:00.000Z",
  businessDate: "2026-01-02",
  cashSeq: "INTERNAL-CASH-SEQUENCE",
  receivedBy: "INTERNAL-STAFF",
};
const header = {
  clinicAr: "عيادة تجريبية",
  clinicEn: "Synthetic Clinic",
  branchNameAr: "فرع تجريبي",
  branchNameEn: "Synthetic Branch",
  timezone: "Asia/Kuwait",
  address: null,
  phone: null,
  commercialRegNo: null,
};
const display = { patientName: "مراجع تجريبي", invoiceNumber: "SYN-2026-000001" };

describe("receipt PDF model", () => {
  it("uses the original stored payment amount without deriving a net from later money movements", () => {
    const source = { ...payment, refundedMinor: "10", refundableMinor: "0", owedMinor: "0" };
    expect(receiptPdfModel(source, header, display)).toMatchObject({
      number: payment.receiptNumber,
      invoiceNumber: display.invoiceNumber,
      patientName: display.patientName,
      amount: "9223372036854775.807",
      currencyAr: "دينار كويتي",
      currencyEn: "KWD",
    });
  });

  it("allowlists print data instead of forwarding IDs, contacts or invoice facts", () => {
    const privateSource = { ...payment, privateNote: "PRIVATE-NOTE" };
    const privateHeader = { ...header, privateKey: "PRIVATE-KEY" };
    const privateDisplay = {
      ...display,
      patientEmail: "PRIVATE-EMAIL",
      invoiceLines: "PRIVATE-LINES",
    };
    const model = receiptPdfModel(privateSource, privateHeader, privateDisplay);
    const result = JSON.stringify(model);
    for (const denied of ["INTERNAL-", "PRIVATE-", "IGNORED-", "patientId", "cashSeq"])
      expect(result).not.toContain(denied);
    expect(model.header).toEqual([{ ar: header.branchNameAr, en: header.branchNameEn }]);
  });

  it("keeps the stored business day and converts receipt time in the clinic zone", () => {
    const model = receiptPdfModel(payment, header, display);
    expect(model.dateEn).toBe("2 January 2026");
    expect(model.dateAr).toBe(
      new Intl.DateTimeFormat("ar-KW", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date("2026-01-02T12:00:00Z"),
      ),
    );
    expect(model.time).toBe("01:30");
    // Stored accounting day must not move if the clinic later changes time zone.
    const moved = receiptPdfModel(payment, { ...header, timezone: "America/New_York" }, display);
    expect(moved.dateEn).toBe(model.dateEn);
    expect(moved.time).toBe("17:30");
  });

  it.each([
    ["KWD", 3, "1.234", "دينار كويتي"],
    ["BHD", 3, "1.234", "دينار بحريني"],
    ["OMR", 3, "1.234", "ريال عماني"],
    ["SAR", 2, "12.34", "ريال سعودي"],
    ["AED", 2, "12.34", "درهم إماراتي"],
    ["QAR", 2, "12.34", "ريال قطري"],
  ] as const)("formats %s without floating-point money", (currency, exponent, amount, name) => {
    expect(
      receiptPdfModel(
        { ...payment, currency, currencyExponent: exponent, amountMinor: "1234" },
        header,
        display,
      ),
    ).toMatchObject({ amount, currencyAr: name, currencyEn: currency });
  });

  it.each([
    ["cash", "نقدًا", "Cash"],
    ["knet", "كي نت", "KNET"],
    ["bank_transfer", "تحويل بنكي", "Bank transfer"],
    ["other", "أخرى", "Other"],
  ] as const)(
    "labels historical %s receipts without a current-settings lookup",
    (method, ar, en) => {
      expect(receiptPdfModel({ ...payment, method }, header, display)).toMatchObject({
        methodAr: ar,
        methodEn: en,
      });
    },
  );

  it("preserves the complete permitted reference and optional header values", () => {
    const reference = "R".repeat(60);
    const model = receiptPdfModel(
      { ...payment, reference },
      { ...header, address: "عنوان تجريبي", phone: "TEST-PHONE", commercialRegNo: "TEST-CR" },
      display,
    );
    expect(model.reference).toBe(reference);
    expect(model.header.slice(1)).toEqual([
      { ar: "عنوان تجريبي", en: "عنوان تجريبي" },
      { ar: "TEST-PHONE", en: "TEST-PHONE" },
      { ar: "TEST-CR", en: "TEST-CR" },
    ]);
    expect(receiptPdfModel(payment, header, display).reference).toBeNull();
  });

  it.each(["\n", "\t", "\u202e"])(
    "refuses unsupported controls in any print source: %j",
    (control) => {
      for (const field of ["receiptNumber", "reference"])
        expect(() =>
          receiptPdfModel({ ...payment, [field]: `Synthetic${control}text` }, header, display),
        ).toThrow("pdf_model_invalid");
      for (const field of [
        "clinicAr",
        "clinicEn",
        "branchNameAr",
        "branchNameEn",
        "address",
        "phone",
        "commercialRegNo",
      ])
        expect(() =>
          receiptPdfModel(payment, { ...header, [field]: `Synthetic${control}text` }, display),
        ).toThrow("pdf_model_invalid");
      for (const field of ["patientName", "invoiceNumber"])
        expect(() =>
          receiptPdfModel(payment, header, { ...display, [field]: `Synthetic${control}text` }),
        ).toThrow("pdf_model_invalid");
    },
  );

  it.each([
    { amountMinor: "0" },
    { amountMinor: "-1" },
    { amountMinor: "invalid" },
    { amountMinor: "+1" },
    { amountMinor: " 1" },
    { amountMinor: "01" },
    { amountMinor: "9223372036854775808" },
    { currencyExponent: 2 },
    { businessDate: "2026-02-30" },
    { businessDate: "2026-1-2" },
    { receivedAt: "invalid" },
    { receivedAt: "2026-02-01" },
    { receivedAt: "2026-02-30T00:00:00Z" },
    { receivedAt: "2026-02-29T00:00:00Z" },
  ])("sanitizes invalid stored amount/date facts: %j", (invalid) => {
    expect(() => receiptPdfModel({ ...payment, ...invalid }, header, display)).toThrow(
      "pdf_model_invalid",
    );
  });

  it("refuses a missing patient display name or unusable clinic time zone", () => {
    expect(() => receiptPdfModel(payment, header, { ...display, patientName: " " })).toThrow(
      "pdf_model_invalid",
    );
    expect(() =>
      receiptPdfModel(payment, { ...header, timezone: "INVALID-ZONE" }, display),
    ).toThrow("pdf_model_invalid");
  });

  it.each(["2024-02-29T12:30Z", "2024-02-29T12:30:00.123456Z"])(
    "preserves accepted UTC timestamp shapes: %s",
    (receivedAt) => {
      expect(receiptPdfModel({ ...payment, receivedAt }, header, display).time).toBe("15:30");
    },
  );
});
