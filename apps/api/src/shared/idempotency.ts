import { createHash } from "node:crypto";

import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** نتيجة حجز المفتاح: جديد، أو إعادة لنفس الطلب، أو نفس المفتاح بطلب مختلف. */
export type IdempotencyClaim<T> =
  | { readonly kind: "new" }
  | { readonly kind: "replay"; readonly response: T }
  | { readonly kind: "conflict" };

// Sorted keys at every depth: the same body always hashes the same, whatever order it was sent in.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

/**
 * بصمة SHA-256 للجسم بعد التحقق، مستقلة عن ترتيب المفاتيح.
 *
 * @param body الجسم بعد الـ contract
 * @returns hex
 */
export function requestHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}

/**
 * بيحجز المفتاح جوه transaction الـ use case (PRD §4.12). طلب متوازي بنفس المفتاح بيستنى الأول
 * يخلص (`ON CONFLICT` بيستنى الـ commit)، وبعدها بيشوف رده المحفوظ؛ لو الأول اترجع، الحجز بيكمل هنا.
 *
 * @param tx الـ transaction
 * @param scope العملية + الفاعل
 * @param key قيمة `Idempotency-Key`
 * @param hash بصمة الجسم
 * @param now الوقت
 * @returns `new` أو `replay` أو `conflict`
 */
export async function claimIdempotencyKey<T>(
  tx: Tx,
  scope: string,
  key: string,
  hash: string,
  now: Date,
): Promise<IdempotencyClaim<T>> {
  const inserted = await tx.execute<{ key: string }>(
    sql`INSERT INTO idempotency_keys (scope, key, request_hash, response, created_at)
        VALUES (${scope}, ${key}, ${hash}, NULL, ${now.toISOString()}::timestamptz)
        ON CONFLICT (scope, key) DO NOTHING RETURNING key`,
  );
  if (inserted.length === 1) return { kind: "new" };
  const rows = await tx.execute<{ request_hash: string; response: T | null }>(
    sql`SELECT request_hash, response FROM idempotency_keys WHERE scope = ${scope} AND key = ${key}`,
  );
  const row = rows[0];
  if (row === undefined || row.request_hash !== hash || row.response === null) {
    return { kind: "conflict" };
  }
  return { kind: "replay", response: row.response };
}

/**
 * بيحفظ الرد على المفتاح في نفس الـ transaction، فالإعادة بترجع نفس النتيجة بالظبط.
 *
 * @param tx الـ transaction
 * @param scope العملية + الفاعل
 * @param key المفتاح
 * @param response الرد (معرّفات بس)
 * @returns بيخلص لما يتحفظ
 */
export async function completeIdempotencyKey(
  tx: Tx,
  scope: string,
  key: string,
  response: unknown,
): Promise<void> {
  await tx.execute(
    sql`UPDATE idempotency_keys SET response = ${JSON.stringify(response)}::jsonb
        WHERE scope = ${scope} AND key = ${key}`,
  );
}
