import type { Invoice } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** كيانات المالية في سجل العيادة (0060): صفوفها وصول لملف مراجع، والمنصة عمرها ما بتشوفها. */
export type FinanceAuditEntity = "invoice" | "invoice_link";

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

/** صف مالي في سجل العيادة: التصنيف `patient_access` دايمًا (0060 بيرفض غيره للكيانات دي). */
export interface FinanceAccessEntry {
  readonly clinicId: string;
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: FinanceAuditEntity;
  readonly entityId: string;
  /** فرع الفاتورة، عشان فلاتر السجل. */
  readonly branchId: string;
  readonly before: InvoiceAuditSnapshot | null;
  readonly after: InvoiceAuditSnapshot | null;
  /** طول سبب الإلغاء أو الخصم بس، عمر النص نفسه ما يتخزن. */
  readonly reasonLength?: number;
  /** فتح من رابط المراجع (R2-7): الفاعل مش موظف، فالصف بيقول ده صراحة. */
  readonly via?: "patient_link";
  readonly createdAt: Date;
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

function assertSnapshotShape(snapshot: InvoiceAuditSnapshot | null): void {
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

/**
 * بيكتب صف مالي (إصدار، تعديل، إلغاء، إرسال) جوه transaction الـ use case. اللقطة بتتخزن زي ما هي
 * عشان المبالغ والرقم مايتشوهوش، وده آمن لأن كل نص فيها بيتراجع على شكله قبل الكتابة.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writeFinanceAudit(tx: Tx, entry: FinanceAccessEntry): Promise<void> {
  assertSnapshotShape(entry.before);
  assertSnapshotShape(entry.after);
  const details = {
    before: entry.before,
    after: entry.after,
    ...(entry.reasonLength === undefined ? {} : { reasonLength: entry.reasonLength }),
    ...(entry.via === undefined ? {} : { via: entry.via }),
  };
  await tx.execute(
    sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
          entity_id, branch_id, details, created_at)
        VALUES (${entry.clinicId}, ${entry.id}, ${entry.actorUserId}, ${entry.action},
          'patient_access', ${entry.entityType}, ${entry.entityId}, ${entry.branchId},
          ${JSON.stringify(details)}::jsonb, ${entry.createdAt.toISOString()}::timestamptz)`,
  );
}
