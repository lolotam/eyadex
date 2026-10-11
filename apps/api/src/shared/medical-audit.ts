import type { Tx } from "@eyadex/db";
import { redactSecrets, scrubAuditValue } from "@eyadex/observability";
import { sql } from "drizzle-orm";

/**
 * الكيانات الطبية اللي صفوفها وصول لملف مراجع (R1-1) والزيارات بتكتبها النهارده؛ المرفقات بتيجي مع
 * شريحتها.
 */
export type MedicalAuditEntity =
  "patient" | "visit" | "visit_addendum" | "diagnosis" | "prescription" | "medical_profile";

/** صف وصول طبي في سجل العيادة: التصنيف `patient_access` دايمًا (0046 بيرفض غيره للكيانات دي). */
export interface MedicalAccessEntry {
  readonly clinicId: string;
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: MedicalAuditEntity;
  /** الكيان، أو `null` لقراية مالهاش كيان واحد (بحث الزيارة المباشرة). */
  readonly entityId: string | null;
  /** فرع الزيارة أو فرع تسجيل الملف، عشان فلاتر السجل. */
  readonly branchId: string | null;
  /** أسماء الحقول بس (`after.changed`)، عمرها ما تبقى قيمة ولا نص بحث (R3-4). */
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * بيكتب صف وصول طبي (فتح زيارة، قايمة معاينات، بحث، حفظ ملاحظة…) جوه transaction الـ use case. المنصة
 * عمرها ما بتشوفه: الـ view الإداري بيستبعد التصنيف ده والكيانات الطبية (0046).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writeMedicalAccessAudit(tx: Tx, entry: MedicalAccessEntry): Promise<void> {
  // Defence in depth over the writers, which record field names only: nothing typed reaches the row.
  const details = redactSecrets(scrubAuditValue(entry.details));
  await tx.execute(
    sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
          entity_id, branch_id, details, created_at)
        VALUES (${entry.clinicId}, ${entry.id}, ${entry.actorUserId}, ${entry.action},
          'patient_access', ${entry.entityType}, ${entry.entityId}, ${entry.branchId},
          ${JSON.stringify(details)}::jsonb, ${entry.createdAt.toISOString()}::timestamptz)`,
  );
}
