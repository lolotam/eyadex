import type { Tx } from "@eyadex/db";
import { redactSecrets } from "@eyadex/observability";
import { sql } from "drizzle-orm";

/** صف إداري في سجل العيادة (0011). `details` قايمة حقول مسموحة بس: مفيش رمز ولا سر ولا رقم مدني. */
export interface ClinicAuditEntry {
  readonly clinicId: string;
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * بيكتب حدث إداري جوه transaction الـ use case (append-only: eyadex_app عنده INSERT و SELECT بس).
 * أحداث المراجعين ليها كاتب تاني بتصنيف `patient_access`؛ الداتابيز بترفض أي خلط (0011).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writeClinicAudit(tx: Tx, entry: ClinicAuditEntry): Promise<void> {
  // Defence in depth over the allowlist: free text (a name, an address) can still carry a token or civil ID.
  const details = redactSecrets(entry.details);
  await tx.execute(
    sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
          entity_id, branch_id, details, created_at)
        VALUES (${entry.clinicId}, ${entry.id}, ${entry.actorUserId}, ${entry.action},
          'administrative', ${entry.entityType}, ${entry.entityId}, NULL,
          ${JSON.stringify(details)}::jsonb, ${entry.createdAt.toISOString()}::timestamptz)`,
  );
}
