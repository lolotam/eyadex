import {
  assertInvoiceAuditSnapshotShape,
  type InvoiceAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
export { invoiceAuditSnapshot } from "@eyadex/contracts/finance-audit-snapshot";
export type {
  DiscountSnapshot,
  InvoiceAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** كيانات المالية في سجل العيادة (0060): صفوفها وصول لملف مراجع، والمنصة عمرها ما بتشوفها. */
export type FinanceAuditEntity = "invoice" | "invoice_link";

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

/**
 * بيكتب صف مالي (إصدار، تعديل، إلغاء، إرسال) جوه transaction الـ use case. اللقطة بتتخزن زي ما هي
 * عشان المبالغ والرقم مايتشوهوش، وده آمن لأن كل نص فيها بيتراجع على شكله قبل الكتابة.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writeFinanceAudit(tx: Tx, entry: FinanceAccessEntry): Promise<void> {
  assertInvoiceAuditSnapshotShape(entry.before);
  assertInvoiceAuditSnapshotShape(entry.after);
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
