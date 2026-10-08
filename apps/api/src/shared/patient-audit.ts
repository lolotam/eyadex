import type { Tx } from "@eyadex/db";
import { redactSecrets } from "@eyadex/observability";
import { sql } from "drizzle-orm";

import { scrubPatientAuditDetails } from "./patient-audit-text.ts";

/** صف وصول لملف مراجع في سجل العيادة (0011): التصنيف `patient_access` والكيان `patient` دايمًا. */
export interface PatientAccessEntry {
  readonly clinicId: string;
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly patientId: string;
  /** فرع تسجيل الملف، عشان فلاتر السجل. */
  readonly branchId: string;
  /** قايمة حقول مسموحة بس: مفيش رقم مدني ولا موبايل كامل. */
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * بيكتب حدث وصول لملف مراجع (فتح، تسجيل، تعديل، أرشفة، استرجاع) جوه transaction الـ use case.
 * التصنيف ثابت `patient_access`، فالمنصة عمرها ما تشوفه (view الإداري بيستبعده، والداتابيز بترفض
 * حدث مراجع إداري).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writePatientAccessAudit(tx: Tx, entry: PatientAccessEntry): Promise<void> {
  // Defence in depth over the writer's allowlist: a name can still carry a civil ID, a phone or a
  // credential. The strict patients pass runs first (glued and non-ASCII digits), then the shared one.
  const details = redactSecrets(scrubPatientAuditDetails(entry.details));
  await tx.execute(
    sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
          entity_id, branch_id, details, created_at)
        VALUES (${entry.clinicId}, ${entry.id}, ${entry.actorUserId}, ${entry.action},
          'patient_access', 'patient', ${entry.patientId}, ${entry.branchId},
          ${JSON.stringify(details)}::jsonb, ${entry.createdAt.toISOString()}::timestamptz)`,
  );
}
