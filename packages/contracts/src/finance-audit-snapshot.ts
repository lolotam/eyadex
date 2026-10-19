import type { Invoice } from "./finance-invoice.ts";

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

// The snapshot skips scrubAuditValue on purpose: that scrub masks any run of 7+ digits as a phone and
// 12+ as a civil ID, so "1000000" or SLM-2026-000123 would be stored mangled. It is safe to skip only
// because every string is checked against these shapes, which no typed name or phone can pass.
const MINOR = /^\d{1,19}$/;
const NUMBER = /^[A-Z0-9]{2,6}-\d{4}-\d{6,}$/;

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
