import type { Invoice } from "@eyadex/contracts/finance";
import { formatMinor, SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";

/** حقول رأس الطباعة المسموحة؛ بيانات المراجع لا تدخل هنا. */
export interface InvoicePdfHeader {
  readonly clinicAr: string;
  readonly clinicEn: string;
  readonly timezone: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly commercialRegNo: string | null;
}

const currencyNames = {
  KWD: "دينار كويتي",
  BHD: "دينار بحريني",
  OMR: "ريال عماني",
  SAR: "ريال سعودي",
  AED: "درهم إماراتي",
  QAR: "ريال قطري",
} as const;

const text = (value: string): string => {
  // The verified layout refuses controls rather than silently dropping document text.
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("pdf_model_invalid");
  return value;
};

const dateText = (value: string, locale: string, timeZone: string): string =>
  text(new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(new Date(value)));

const discountText = (discount: Invoice["invoiceDiscount"], exponent: number): string => {
  if (discount === null) return formatMinor("0", exponent);
  // Display the saved discount instruction, not a newly calculated allocation or net amount.
  return discount.kind === "amount"
    ? formatMinor(discount.minor, exponent)
    : `${formatMinor(String(discount.bp), 2)}%`;
};

/**
 * يبني حقول الطباعة صراحةً؛ لا ينسخ معرّفات أو بيانات اتصال المراجع ولا يعيد حساب الإجماليات.
 * @param invoice الفاتورة المحفوظة بسطورها المرتبة
 * @param header حقول العيادة والفرع المسموحة للطباعة
 * @param patientName اسم عرض المراجع المقروء من منفذ المراجعين
 * @returns نموذج نصي للطباعة فقط، بلا معرّفات داخلية أو حقول المراجع الأخرى
 */
export function invoicePdfModel(invoice: Invoice, header: InvoicePdfHeader, patientName: string) {
  if (
    !patientName.trim() ||
    invoice.lines.length > 50 ||
    invoice.currencyExponent !== SUPPORTED_CURRENCIES[invoice.currency] ||
    (invoice.status === "void" && (!invoice.voidReason || !invoice.voidedAt))
  ) {
    throw new Error("pdf_model_invalid");
  }
  const money = (minor: string) => formatMinor(minor, invoice.currencyExponent);
  const totals = [
    { ar: "المجموع الفرعي", en: "Subtotal", value: money(invoice.subtotalMinor) },
    { ar: "الخصم", en: "Discount", value: money(invoice.discountMinor) },
    ...(invoice.taxMinor !== "0"
      ? [{ ar: "الضريبة", en: "Tax", value: money(invoice.taxMinor) }]
      : []),
    { ar: "الإجمالي", en: "Total", value: money(invoice.totalMinor) },
  ];
  return {
    clinicAr: text(header.clinicAr),
    clinicEn: text(header.clinicEn),
    header: [
      { ar: text(invoice.branchNameAr), en: text(invoice.branchNameEn) },
      ...(header.address ? [{ ar: text(header.address), en: text(header.address) }] : []),
      ...(header.phone ? [{ ar: text(header.phone), en: text(header.phone) }] : []),
      ...(header.commercialRegNo
        ? [{ ar: text(header.commercialRegNo), en: text(header.commercialRegNo) }]
        : []),
    ],
    number: text(invoice.number),
    version: String(invoice.version),
    dateAr: dateText(invoice.issuedAt, "ar-KW", header.timezone),
    dateEn: dateText(invoice.issuedAt, "en-GB", header.timezone),
    statusAr: invoice.status === "void" ? "ملغاة" : "صادرة",
    statusEn: invoice.status === "void" ? "Void" : "Issued",
    patientName: text(patientName),
    currency: invoice.currency,
    currencyAr: currencyNames[invoice.currency],
    currencyEn: invoice.currency,
    lines: invoice.lines.map((line) => ({
      position: String(line.position + 1),
      descriptionAr: text(line.descriptionAr),
      descriptionEn: text(line.descriptionEn),
      quantity: String(line.quantity),
      unitPrice: money(line.unitPriceMinor),
      discount: discountText(line.discount, invoice.currencyExponent),
      discountReason: line.discount ? text(line.discount.reason) : null,
      total: money(line.lineTotalMinor),
    })),
    totals,
    invoiceDiscountReason: invoice.invoiceDiscount ? text(invoice.invoiceDiscount.reason) : null,
    voidReason: invoice.status === "void" ? text(invoice.voidReason!) : null,
    voidDateAr:
      invoice.status === "void" ? dateText(invoice.voidedAt!, "ar-KW", header.timezone) : null,
    voidDateEn:
      invoice.status === "void" ? dateText(invoice.voidedAt!, "en-GB", header.timezone) : null,
  };
}

export type InvoicePdfModel = ReturnType<typeof invoicePdfModel>;
