import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** حدث بيتكتب في الـ outbox جوه نفس transaction الـ use case (ADR-0006). */
export interface OutboxEvent {
  readonly id: string;
  /** `null` بس لحدث المنصة اللي مالوش عيادة؛ لازم يساوي سياق الـ transaction (RLS). */
  readonly clinicId: string | null;
  readonly type: string;
  /** مفيش سر مكشوف هنا أبدًا: الرمز بيتقفل بـ `SecretSealer` قبل ما يدخل. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * بيضيف الحدث للـ outbox. الكاتب مايقدرش يقرا ولا يعدّل بعدها — الـ dispatcher بس.
 *
 * @param tx الـ transaction بتاعة الـ use case
 * @param event الحدث
 * @returns بيخلص لما الصف يتكتب
 */
export async function appendOutboxEvent(tx: Tx, event: OutboxEvent): Promise<void> {
  await tx.execute(
    sql`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at)
        VALUES (${event.id}, ${event.clinicId}, ${event.type}, ${JSON.stringify(event.payload)}::jsonb,
                ${event.createdAt.toISOString()}::timestamptz, NULL)`,
  );
}
