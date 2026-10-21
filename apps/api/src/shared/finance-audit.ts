import {
  assertFinanceAuditSnapshotShape,
  type FinanceAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
export { invoiceAuditSnapshot } from "@eyadex/contracts/finance-audit-snapshot";
export type {
  CashClosingAuditSnapshot,
  CreditAuditSnapshot,
  DiscountSnapshot,
  FinanceAuditSnapshot,
  InvoiceAuditSnapshot,
  PaymentAuditSnapshot,
  RefundAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * كيانات المالية في سجل العيادة (0060، 0064): الفاتورة والدفعة والرصيد والاسترداد وصول لملف مراجع،
 * وإقفال الصندوق حدث إداري ما بيسمّيش مراجع. المنصة عمرها ما بتشوف أي واحد منهم (F2-Q19)، وطرق الدفع
 * ماتوصلش هنا لأنها إعداد عيادة.
 */
export type FinanceAuditEntity =
  "invoice" | "invoice_link" | "payment" | "patient_credit" | "refund" | "cash_closing";

/** صف مالي في سجل العيادة: تصنيفه بييجي من كيانه (`patient_access`، أو `administrative` للإقفال). */
export interface FinanceAccessEntry {
  readonly clinicId: string;
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: FinanceAuditEntity;
  readonly entityId: string;
  /** فرع الفاتورة أو الإقفال، عشان فلاتر السجل. */
  readonly branchId: string;
  readonly before: FinanceAuditSnapshot | null;
  readonly after: FinanceAuditSnapshot | null;
  /** طول سبب الإلغاء أو الخصم بس، عمر النص نفسه ما يتخزن. */
  readonly reasonLength?: number;
  /** فتح من رابط المراجع (R2-7): الفاعل مش موظف، فالصف بيقول ده صراحة. */
  readonly via?: "patient_link";
  readonly createdAt: Date;
}

/**
 * تصنيف الصف: إقفال الصندوق ما بيسمّيش مراجع فهو إداري (spec §4.6)، والباقي وصول لملف مراجع (0060 و
 * 0064 بيرفضوا غيره للكيانات دي).
 */
const categoryOf = (entity: FinanceAuditEntity): "patient_access" | "administrative" =>
  entity === "cash_closing" ? "administrative" : "patient_access";

/**
 * بيكتب صف مالي (إصدار، تعديل، إلغاء، إرسال، دفعة، استرداد، إقفال) جوه transaction الـ use case. اللقطة
 * بتتخزن زي ما هي عشان المبالغ والأرقام مايتشوهوش، وده آمن لأن كل نص فيها بيتراجع على شكله قبل الكتابة.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writeFinanceAudit(tx: Tx, entry: FinanceAccessEntry): Promise<void> {
  assertFinanceAuditSnapshotShape(entry.entityType, entry.before);
  assertFinanceAuditSnapshotShape(entry.entityType, entry.after);
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
          ${categoryOf(entry.entityType)}, ${entry.entityType}, ${entry.entityId}, ${entry.branchId},
          ${JSON.stringify(details)}::jsonb, ${entry.createdAt.toISOString()}::timestamptz)`,
  );
}
