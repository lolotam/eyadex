import { describe, expect, it } from "vitest";
import { receiptSource } from "../../../../assets/receipt-pdf/template.mjs";
import { receiptPdfModel } from "../domain/receipt-pdf-model.ts";

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
const model = receiptPdfModel(
  {
    receiptNumber: "SYN-R-001",
    method: "cash",
    amountMinor: "1234",
    currency: "KWD",
    currencyExponent: 3,
    reference: null,
    receivedAt: "2026-01-01T22:30:00.000Z",
    businessDate: "2026-01-02",
  },
  header,
  { patientName: "مراجع تجريبي", invoiceNumber: "SYN-I-001" },
);

describe("receipt template", () => {
  it("uses receipt facts without inventing invoice line items", () => {
    const { source, fields, words } = receiptSource(model);
    for (const value of [
      model.number,
      model.invoiceNumber,
      model.patientName,
      model.dateAr,
      model.dateEn,
      model.time,
      model.methodAr,
      model.methodEn,
    ])
      expect(fields).toContain(value);
    expect(fields).toContain(`${model.amount} ${model.currencyAr}`);
    expect(fields).toContain(`${model.amount} ${model.currencyEn}`);
    expect(source).not.toContain("subtotal");
    expect(fields).not.toContain("Reference");
    expect(Object.values(words)).not.toContain("undefined");
  });

  it("includes the full reference and ignores unexpected source properties", () => {
    const reference = "R".repeat(60);
    const { fields, source } = receiptSource({
      ...model,
      reference,
      privateNote: "PRIVATE",
    } as typeof model);
    expect(fields.filter((value) => value === reference)).toHaveLength(2);
    expect(source).not.toContain("PRIVATE");
  });

  it("encodes Typst-looking text as data", () => {
    const value = 'Synthetic #panic("not executable")';
    const { fields, source } = receiptSource({ ...model, patientName: value });
    expect(fields).toContain(value);
    expect(source).not.toContain(value);
    expect(source).toContain("json(bytes(");
  });

  it.each(["\n", "\t", "\u202e"])("refuses controls before tokenization: %j", (value) => {
    expect(() => receiptSource({ ...model, reference: `ref${value}tail` })).toThrow(
      "unsupported_format_character",
    );
  });

  it("accepts only parent-owned logo basenames", () => {
    expect(receiptSource(model, { logoFile: "logo.png" }).source).toContain('#image("logo.png"');
    expect(() => receiptSource(model, { logoFile: "../private" as "logo.png" })).toThrow(
      "receipt_logo_path",
    );
  });
});
