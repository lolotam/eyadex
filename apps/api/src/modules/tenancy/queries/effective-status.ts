import { sql, type SQL } from "drizzle-orm";

/**
 * الحالة الفعلية لعيادة في SQL (ADR-0020، SUB-02): الموقوفة موقوفة، وغير كده المنتهية لما
 * `expires_at <= now` — نفس حد `decideClinicAccess` — وغير كده الحالة المخزّنة. "منتهي" مش بيتخزن.
 *
 * @param now الوقت من الـ Clock المحقون
 * @returns تعبير SQL على أعمدة `status` و `expires_at`
 */
export function effectiveStatusSql(now: Date): SQL {
  return sql`(CASE WHEN status = 'suspended' THEN 'suspended'
    WHEN expires_at <= ${now.toISOString()}::timestamptz THEN 'expired'
    ELSE status END)`;
}
