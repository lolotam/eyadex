import { paymentSchema, type Payment } from "@eyadex/contracts/finance";
import { instantToWall } from "@eyadex/contracts/clinic-time";
import {
  formatMinor,
  positiveMinorAmountSchema,
  SUPPORTED_CURRENCIES,
} from "@eyadex/contracts/money";
import type { InvoicePdfHeader } from "./invoice-pdf-model.ts";

/** بيانات الدفعة المالية المحفوظة فقط؛ لا يحتاج النموذج أي معرّف داخلي. */
export type ReceiptPdfSource = Pick<
  Payment,
  | "receiptNumber"
  | "method"
  | "amountMinor"
  | "currency"
  | "currencyExponent"
  | "reference"
  | "receivedAt"
  | "businessDate"
>;

/** رأس الطباعة المسموح، مع اسمي فرع الدفعة المقروءين داخل نطاق العيادة. */
export interface ReceiptPdfHeader extends InvoicePdfHeader {
  readonly branchNameAr: string;
  readonly branchNameEn: string;
}

/** نصوص العرض المقروءة من منافذها؛ لا تشمل اتصال المراجع أو تفاصيل الفاتورة. */
export interface ReceiptPdfDisplay {
  readonly patientName: string;
  readonly invoiceNumber: string;
}

const currencies = {
  KWD: "دينار كويتي",
  BHD: "دينار بحريني",
  OMR: "ريال عماني",
  SAR: "ريال سعودي",
  AED: "درهم إماراتي",
  QAR: "ريال قطري",
} as const;

const methods = {
  cash: { ar: "نقدًا", en: "Cash" },
  knet: { ar: "كي نت", en: "KNET" },
  bank_transfer: { ar: "تحويل بنكي", en: "Bank transfer" },
  other: { ar: "أخرى", en: "Other" },
} as const;

const text = (value: string): string => {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("pdf_model_invalid");
  return value;
};

/**
 * يحوّل الدفعة إلى حقول إيصال نصية صريحة بلا حساب صافي أو نسخ بيانات داخلية.
 * @param payment حقائق الدفعة المحفوظة؛ المبلغ هو المستلم الأصلي وليس المتبقي بعد الاسترداد
 * @param header رأس العيادة والفرع المسموح للطباعة
 * @param display اسم عرض المراجع ورقم الفاتورة فقط
 * @returns نموذج إيصال ثنائي اللغة؛ يومه التجاري محفوظ ووقته بمنطقة العيادة
 */
export function receiptPdfModel(
  payment: ReceiptPdfSource,
  header: ReceiptPdfHeader,
  display: ReceiptPdfDisplay,
) {
  try {
    if (
      !display.patientName.trim() ||
      payment.currencyExponent !== SUPPORTED_CURRENCIES[payment.currency] ||
      !methods[payment.method] ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payment.businessDate) ||
      !positiveMinorAmountSchema.safeParse(payment.amountMinor).success ||
      !paymentSchema.shape.receivedAt.safeParse(payment.receivedAt).success
    ) {
      throw new Error("pdf_model_invalid");
    }
    // The stored business date remains authoritative, independently of later time-zone changes.
    const day = new Date(`${payment.businessDate}T12:00:00.000Z`);
    if (day.toISOString().slice(0, 10) !== payment.businessDate)
      throw new Error("pdf_model_invalid");
    const date = (locale: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(day);
    return {
      clinicAr: text(header.clinicAr),
      clinicEn: text(header.clinicEn),
      header: [
        { ar: text(header.branchNameAr), en: text(header.branchNameEn) },
        ...(header.address ? [{ ar: text(header.address), en: text(header.address) }] : []),
        ...(header.phone ? [{ ar: text(header.phone), en: text(header.phone) }] : []),
        ...(header.commercialRegNo
          ? [{ ar: text(header.commercialRegNo), en: text(header.commercialRegNo) }]
          : []),
      ],
      number: text(payment.receiptNumber),
      invoiceNumber: text(display.invoiceNumber),
      patientName: text(display.patientName),
      dateAr: date("ar-KW"),
      dateEn: date("en-GB"),
      time: instantToWall(payment.receivedAt, header.timezone).time,
      methodAr: methods[payment.method].ar,
      methodEn: methods[payment.method].en,
      reference: payment.reference === null ? null : text(payment.reference),
      amount: formatMinor(payment.amountMinor, payment.currencyExponent),
      currencyAr: currencies[payment.currency],
      currencyEn: payment.currency,
    };
  } catch {
    // Date/amount errors must not expose source values or native exception messages.
    throw new Error("pdf_model_invalid");
  }
}

export type ReceiptPdfModel = ReturnType<typeof receiptPdfModel>;
