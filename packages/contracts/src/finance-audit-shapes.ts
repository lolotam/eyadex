import { PAYMENT_METHODS, type PaymentMethod } from "./finance-payments.ts";

// The finance snapshots skip scrubAuditValue on purpose: that scrub masks any run of 7+ digits as a phone
// and 12+ as a civil ID, so "1000000" or SLM-2026-000123 would be stored mangled. It is safe to skip only
// because every string is checked against these shapes, which no typed name or phone can pass.
export const MINOR = /^\d{1,19}$/;
// A closing's expected amount and difference may be negative (R3-5): an optional sign, then digits.
export const SIGNED_MINOR = /^-?\d{1,19}$/;
export const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const NUMBER = /^[A-Z0-9]{2,6}-\d{4}-\d{6,}$/;
export const RECEIPT_NUMBER = /^[A-Z0-9]{2,6}-R-\d{4}-\d{6,}$/;
export const REFUND_NUMBER = /^[A-Z0-9]{2,6}-RF-\d{4}-\d{6,}$/;
export const CURRENCY_CODE = /^[A-Z]{3}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The fields a refund and a cash closing snapshot keep (spec §4.6): the API's audit allowlist shows these
 * and nothing else, and the web labels every one of them.
 */
export const REFUND_AUDIT_FIELDS = [
  "refundNumber",
  "invoiceNumber",
  "method",
  "amountMinor",
  "currency",
  "cashSeq",
  "source",
  "receiptNumber",
  "spends",
  "reasonLength",
] as const;
export const CASH_CLOSING_AUDIT_FIELDS = [
  "businessDate",
  "fromCashSeq",
  "toCashSeq",
  "expectedMinor",
  "countedMinor",
  "differenceMinor",
  "currency",
  "previousClosingId",
  "noteLength",
] as const;

/** A typed text's length (a refund reason, a closing note: 1–300): a number, never the text. */
const textLength = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 300;

/** رصيد واحد اتصرف: معرّف الرصيد والمبلغ. */
function creditSpendShape(spend: unknown): boolean {
  if (typeof spend !== "object" || spend === null) return false;
  const row = spend as { readonly creditId: string; readonly amountMinor: string };
  return (
    typeof row.creditId === "string" &&
    UUID.test(row.creditId) &&
    typeof row.amountMinor === "string" &&
    MINOR.test(row.amountMinor)
  );
}

/**
 * قائمة الأرصدة اللي عملية واحدة صرفتها (استخدام رصيد أو استرداد): كل رصيد بمعرّفه ومبلغه.
 *
 * @param spends القيمة اللي في اللقطة
 * @returns صح لو كل عنصر على شكله
 */
export function creditSpendsShape(spends: unknown): boolean {
  if (!Array.isArray(spends)) return false;
  return spends.every((spend) => creditSpendShape(spend));
}

/**
 * لقطة استرداد (مالية F2، F2-Q13): رقم الاسترداد ورقم الفاتورة وطريقة الصرف والمبلغ والعملة ورقم الكاش،
 * ومصدره (دفعة أو رصيد) والأرصدة اللي صرفها، وطول السبب. السبب نفسه عمره ما بيتخزن هنا.
 */
export interface RefundAuditSnapshot {
  readonly refundNumber: string;
  readonly invoiceNumber: string;
  readonly method: PaymentMethod;
  readonly amountMinor: string;
  readonly currency: string;
  readonly cashSeq: string | null;
  readonly source: "payment" | "credit";
  readonly receiptNumber?: string;
  readonly spends: readonly { readonly creditId: string; readonly amountMinor: string }[];
  readonly reasonLength: number;
}

/**
 * لقطة إقفال الصندوق (مالية F2، FIN-15): يوم العمل وفترة أرقام الكاش والمتوقع والمعدود والفرق (المتوقع
 * والفرق ممكن يبقوا سالب) والعملة والإقفال اللي قبله، وطول الملاحظة لو فيه. النص نفسه ما بيتخزنش.
 */
export interface CashClosingAuditSnapshot {
  readonly businessDate: string;
  readonly fromCashSeq: string;
  readonly toCashSeq: string;
  readonly expectedMinor: string;
  readonly countedMinor: string;
  readonly differenceMinor: string;
  readonly currency: string;
  readonly previousClosingId: string | null;
  readonly noteLength?: number;
}

/**
 * لقطة الاسترداد على شكلها: رقم الاسترداد ورقم الفاتورة والمبلغ والعملة والطريقة والمصدر والأرصدة.
 *
 * @param snapshot اللقطة
 * @returns صح لو كل حقل على شكله
 */
export function refundSnapshotShape(snapshot: unknown): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const refund = snapshot as RefundAuditSnapshot;
  return (
    typeof refund.refundNumber === "string" &&
    REFUND_NUMBER.test(refund.refundNumber) &&
    typeof refund.invoiceNumber === "string" &&
    NUMBER.test(refund.invoiceNumber) &&
    typeof refund.amountMinor === "string" &&
    MINOR.test(refund.amountMinor) &&
    typeof refund.currency === "string" &&
    CURRENCY_CODE.test(refund.currency) &&
    (refund.cashSeq === null ||
      (typeof refund.cashSeq === "string" && MINOR.test(refund.cashSeq))) &&
    PAYMENT_METHODS.includes(refund.method) &&
    (refund.source === "payment" || refund.source === "credit") &&
    (refund.receiptNumber === undefined ||
      (typeof refund.receiptNumber === "string" && RECEIPT_NUMBER.test(refund.receiptNumber))) &&
    creditSpendsShape(refund.spends) &&
    textLength(refund.reasonLength)
  );
}

/**
 * لقطة الإقفال على شكلها: يوم العمل وأرقام الكاش والمبالغ (المتوقع والفرق بإشارة) والعملة.
 *
 * @param snapshot اللقطة
 * @returns صح لو كل حقل على شكله
 */
export function cashClosingSnapshotShape(snapshot: unknown): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const closing = snapshot as CashClosingAuditSnapshot;
  return (
    typeof closing.businessDate === "string" &&
    BUSINESS_DATE.test(closing.businessDate) &&
    [closing.fromCashSeq, closing.toCashSeq, closing.countedMinor].every(
      (value) => typeof value === "string" && MINOR.test(value),
    ) &&
    [closing.expectedMinor, closing.differenceMinor].every(
      (value) => typeof value === "string" && SIGNED_MINOR.test(value),
    ) &&
    typeof closing.currency === "string" &&
    CURRENCY_CODE.test(closing.currency) &&
    (closing.previousClosingId === null ||
      (typeof closing.previousClosingId === "string" && UUID.test(closing.previousClosingId))) &&
    (closing.noteLength === undefined || textLength(closing.noteLength))
  );
}
