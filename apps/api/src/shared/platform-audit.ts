import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** صف في سجل المنصة (0012). `details` قايمة حقول مسموحة بس: مفيش رمز ولا hash ولا سر. */
export interface PlatformAuditEntry {
  readonly id: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly clinicId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * بيكتب حدث منصة جوه transaction الـ use case — append-only (المنصة عندها INSERT و SELECT بس).
 *
 * @param tx الـ transaction على `eyadex_platform`
 * @param entry الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function writePlatformAudit(tx: Tx, entry: PlatformAuditEntry): Promise<void> {
  await tx.execute(
    sql`INSERT INTO platform_audit_log (id, actor_user_id, action, clinic_id, details, created_at)
        VALUES (${entry.id}, ${entry.actorUserId}, ${entry.action}, ${entry.clinicId},
                ${JSON.stringify(entry.details)}::jsonb, ${entry.createdAt.toISOString()}::timestamptz)`,
  );
}
