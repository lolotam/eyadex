import {
  cashClosingSnapshotShape,
  creditSpendsShape,
  CURRENCY_CODE,
  MINOR,
  NUMBER,
  RECEIPT_NUMBER,
  refundSnapshotShape,
  UUID,
  type CashClosingAuditSnapshot,
  type RefundAuditSnapshot,
} from "./finance-audit-shapes.ts";
import type { Invoice } from "./finance-invoice.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "./finance-payments.ts";

export type { CashClosingAuditSnapshot, RefundAuditSnapshot } from "./finance-audit-shapes.ts";

/** خصم في اللقطة: نوعه وقيمته بس، من غير السبب المكتوب. */
export type DiscountSnapshot =
  | { readonly scope: "invoice" | "line"; readonly kind: "pct"; readonly bp: number }
  | { readonly scope: "invoice" | "line"; readonly kind: "amount"; readonly minor: string };

/**
 * لقطة فاتورة قبل/بعد (plan Task 8j): أرقام ورموز من الكود بس. مفيش وصف سطر ولا سبب خصم ولا سبب
 * إلغاء، لأن دي نصوص بيكتبها حد وممكن يبقى فيها اسم المراجع.
 */
export interface InvoiceAuditSnapshot {
  readonly number: string;
  readonly status: Invoice["status"];
  readonly version: number;
  readonly subtotalMinor: string;
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly lineCount: number;
  readonly discounts: readonly DiscountSnapshot[];
}

/**
 * لقطة دفعة (مالية F2): رقم الإيصال ورقم الفاتورة وطريقة الدفع والمبلغ والعملة ورقم الكاش. من غير
 * المرجع ولا اسم المراجع، عشان السجل ما يحملش نص كتبه حد.
 */
export interface PaymentAuditSnapshot {
  readonly receiptNumber: string;
  readonly invoiceNumber: string;
  readonly method: PaymentMethod;
  readonly amountMinor: string;
  readonly currency: string;
  readonly cashSeq: string | null;
}

/**
 * لقطة رصيد المراجع (مالية F2): رقم الفاتورة والمبلغ والعملة. `cause` و`allocationId` بيوصّفوا release
 * واحد (`credit.released`)، و`spends` بيوصّفوا الأرصدة اللي دفعة واحدة (`credit.applied`) صرفتها،
 * من الأقدم للأحدث.
 */
export interface CreditAuditSnapshot {
  readonly invoiceNumber: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly cause?: "invoice_edited" | "invoice_voided" | "refund";
  readonly allocationId?: string;
  readonly spends?: readonly { readonly creditId: string; readonly amountMinor: string }[];
}

/** أي لقطة مالية بتتخزن في سجل العيادة: فاتورة أو دفعة أو رصيد مراجع أو استرداد أو إقفال صندوق. */
export type FinanceAuditSnapshot =
  | InvoiceAuditSnapshot
  | PaymentAuditSnapshot
  | CreditAuditSnapshot
  | RefundAuditSnapshot
  | CashClosingAuditSnapshot;

// Every string of a finance snapshot is checked against the shapes of finance-audit-shapes.ts before it
// is stored, which is why the snapshot may skip the audit scrub.
const CREDIT_CAUSES = ["invoice_edited", "invoice_voided", "refund"] as const;

/** نفس رسالة فشل لقطة الفاتورة، عشان القارئ يشوف سبب واحد لكل اللقطة المالية. */
const SHAPE_ERROR = "finance audit snapshot holds a value outside its shape";

function discountSnapshot(
  scope: DiscountSnapshot["scope"],
  discount: NonNullable<Invoice["invoiceDiscount"]>,
): DiscountSnapshot {
  return discount.kind === "pct"
    ? { scope, kind: "pct", bp: discount.bp }
    : { scope, kind: "amount", minor: discount.minor };
}

/**
 * بيبني لقطة السجل من الفاتورة زي ما اتحفظت، بالحقول المسموحة بس.
 *
 * @param invoice الفاتورة بعد الحفظ أو قبل التعديل
 * @returns اللقطة اللي تتكتب في `before` أو `after`
 */
export function invoiceAuditSnapshot(invoice: Invoice): InvoiceAuditSnapshot {
  const discounts = [
    ...invoice.lines.flatMap((line) =>
      line.discount === null ? [] : [discountSnapshot("line", line.discount)],
    ),
    ...(invoice.invoiceDiscount === null
      ? []
      : [discountSnapshot("invoice", invoice.invoiceDiscount)]),
  ];
  return {
    number: invoice.number,
    status: invoice.status,
    version: invoice.version,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    lineCount: invoice.lines.length,
    discounts,
  };
}

/** يمنع تخزين نص حر مكان رقم الفاتورة أو مبالغها قبل تجاوز تنقية سجل التدقيق. */
export function assertInvoiceAuditSnapshotShape(snapshot: InvoiceAuditSnapshot | null): void {
  if (snapshot === null) return;
  const amounts = [
    snapshot.subtotalMinor,
    snapshot.discountMinor,
    snapshot.taxMinor,
    snapshot.totalMinor,
    ...snapshot.discounts.flatMap((d) => (d.kind === "amount" ? [d.minor] : [])),
  ];
  if (!NUMBER.test(snapshot.number) || !amounts.every((a) => MINOR.test(a))) {
    throw new Error("finance audit snapshot holds a value outside its shape");
  }
}

/** لقطة الدفعة على شكلها: رقم الإيصال ورقم الفاتورة والمبلغ والعملة وطريقة الدفع. */
function paymentSnapshotShape(snapshot: unknown): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const payment = snapshot as PaymentAuditSnapshot;
  return (
    typeof payment.receiptNumber === "string" &&
    RECEIPT_NUMBER.test(payment.receiptNumber) &&
    typeof payment.invoiceNumber === "string" &&
    NUMBER.test(payment.invoiceNumber) &&
    typeof payment.amountMinor === "string" &&
    MINOR.test(payment.amountMinor) &&
    typeof payment.currency === "string" &&
    CURRENCY_CODE.test(payment.currency) &&
    (payment.cashSeq === null ||
      (typeof payment.cashSeq === "string" && MINOR.test(payment.cashSeq))) &&
    PAYMENT_METHODS.includes(payment.method)
  );
}

/** لقطة رصيد المراجع على شكلها: رقم الفاتورة والمبلغ والعملة والسبب والتخصيص. */
function creditSnapshotShape(snapshot: unknown): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const credit = snapshot as CreditAuditSnapshot;
  return (
    typeof credit.invoiceNumber === "string" &&
    NUMBER.test(credit.invoiceNumber) &&
    typeof credit.amountMinor === "string" &&
    MINOR.test(credit.amountMinor) &&
    typeof credit.currency === "string" &&
    CURRENCY_CODE.test(credit.currency) &&
    (credit.cause === undefined || CREDIT_CAUSES.includes(credit.cause)) &&
    (credit.allocationId === undefined ||
      (typeof credit.allocationId === "string" && UUID.test(credit.allocationId))) &&
    (credit.spends === undefined || creditSpendsShape(credit.spends))
  );
}

/** لقطة الفاتورة على شكلها: نفس فحص الفاتورة، بس بلقطة من نوع تاني ما بتعديش. */
function assertInvoiceSnapshotShape(snapshot: unknown): void {
  const invoice = snapshot as InvoiceAuditSnapshot;
  // The invoice assert reads `discounts`, so a snapshot of another kind must not reach it.
  if (!Array.isArray(invoice.discounts)) throw new Error(SHAPE_ERROR);
  assertInvoiceAuditSnapshotShape(invoice);
}

/** كيانات المالية اللي لقطاتها بتتراجع على شكلها قبل الكتابة. */
export type FinanceSnapshotEntity =
  "invoice" | "invoice_link" | "payment" | "patient_credit" | "refund" | "cash_closing";

/**
 * يمنع تخزين نص حر مكان أرقام الدفعة أو رصيد المراجع أو الاسترداد أو الإقفال قبل تجاوز تنقية سجل
 * التدقيق: كل نص في اللقطة المالية بيتأكد من شكله، واللقطة دي ما بتاخدش غير معرّفات وأرقام.
 *
 * @param entity الكيان اللي اللقطة بتاعته
 * @param snapshot اللقطة، أو `null` لما مفيش لقطة
 * @returns مفيش قيمة؛ بترجع لو اللقطة على شكلها
 * @throws Error لما لقطة حاجة بره شكلها
 */
export function assertFinanceAuditSnapshotShape(
  entity: FinanceSnapshotEntity,
  snapshot: FinanceAuditSnapshot | null,
): void {
  if (snapshot === null) return;
  switch (entity) {
    case "invoice":
      assertInvoiceSnapshotShape(snapshot);
      return;
    case "invoice_link":
      // Opening a link writes no snapshot: nothing of the invoice may travel with it.
      throw new Error(SHAPE_ERROR);
    case "payment":
      if (!paymentSnapshotShape(snapshot)) throw new Error(SHAPE_ERROR);
      return;
    case "patient_credit":
      if (!creditSnapshotShape(snapshot)) throw new Error(SHAPE_ERROR);
      return;
    case "refund":
      if (!refundSnapshotShape(snapshot)) throw new Error(SHAPE_ERROR);
      return;
    case "cash_closing":
      if (!cashClosingSnapshotShape(snapshot)) throw new Error(SHAPE_ERROR);
      return;
  }
}
