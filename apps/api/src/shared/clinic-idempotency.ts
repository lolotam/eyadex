import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { IdempotencyClaim } from "./idempotency.ts";

/** مفتاح طلب جوه عيادة: العملية + الفاعل + القيمة + بصمة الجسم. */
export interface ClinicIdempotencyKey {
  readonly clinicId: string;
  readonly scope: string;
  readonly key: string;
  readonly hash: string;
}

/**
 * زي `claimIdempotencyKey` بس على `clinic_idempotency_keys` (0028، RLS على العيادة): عيادة
 * ماتقدرش تشوف ردود عيادة تانية. طلب متوازي بنفس المفتاح بيستنى الأول يخلص (`ON CONFLICT`).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param claim المفتاح
 * @param id uuid الصف
 * @param now الوقت
 * @returns `new` أو `replay` أو `conflict`
 */
export async function claimClinicIdempotencyKey<T>(
  tx: Tx,
  claim: ClinicIdempotencyKey,
  id: string,
  now: Date,
): Promise<IdempotencyClaim<T>> {
  const { clinicId, scope, key, hash } = claim;
  const inserted = await tx.execute<{ id: string }>(
    sql`INSERT INTO clinic_idempotency_keys (clinic_id, id, scope, key, request_hash, response, created_at)
        VALUES (${clinicId}, ${id}, ${scope}, ${key}, ${hash}, NULL, ${now.toISOString()}::timestamptz)
        ON CONFLICT (clinic_id, scope, key) DO NOTHING RETURNING id`,
  );
  if (inserted.length === 1) return { kind: "new" };
  const rows = await tx.execute<{ request_hash: string; response: T | null }>(
    sql`SELECT request_hash, response FROM clinic_idempotency_keys
        WHERE clinic_id = ${clinicId} AND scope = ${scope} AND key = ${key}`,
  );
  const row = rows[0];
  if (row === undefined || row.request_hash !== hash || row.response === null) {
    return { kind: "conflict" };
  }
  return { kind: "replay", response: row.response };
}

/**
 * بيحفظ الرد (معرّفات بس) في نفس الـ transaction.
 *
 * @param tx الـ transaction
 * @param claim المفتاح
 * @param response الرد
 * @returns بيخلص لما يتحفظ
 */
export async function completeClinicIdempotencyKey(
  tx: Tx,
  claim: ClinicIdempotencyKey,
  response: unknown,
): Promise<void> {
  await tx.execute(
    sql`UPDATE clinic_idempotency_keys SET response = ${JSON.stringify(response)}::jsonb
        WHERE clinic_id = ${claim.clinicId} AND scope = ${claim.scope} AND key = ${claim.key}`,
  );
}
