import type { MailProviderSlot } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { MailProviderRecord, SplitRequest } from "../domain/mail-provider-rules.ts";

type Row = {
  id: string;
  kind: "resend" | "smtp";
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  verified_at: string | null;
  last_error: string | null;
  degraded_at: string | null;
  version: number;
};

const date = (v: string | null) => (v === null ? null : new Date(v));

const record = (row: Row): MailProviderRecord => ({
  id: row.id,
  kind: row.kind,
  fromName: row.from_name,
  fromEmail: row.from_email,
  replyTo: row.reply_to,
  smtpHost: row.smtp_host,
  smtpPort: row.smtp_port,
  smtpUser: row.smtp_user,
  verifiedAt: date(row.verified_at),
  lastError: row.last_error,
  degradedAt: date(row.degraded_at),
  version: row.version,
});

/**
 * صف خانة واحدة من مزودي العيادة (واحد بالكتير لكل خانة، 0055)، بقفل `FOR UPDATE` لو طُلب. الختم
 * مابيتقراش هنا أبداً.
 */
export async function findMailProvider(
  tx: Tx,
  clinicId: string,
  slot: MailProviderSlot,
  forUpdate = false,
): Promise<MailProviderRecord | null> {
  const lock = forUpdate ? sql` FOR UPDATE` : sql``;
  const rows = await tx.execute<Row>(
    sql`SELECT id, kind, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
               verified_at, last_error, degraded_at, version
        FROM clinic_mail_providers WHERE clinic_id = ${clinicId} AND slot = ${slot}${lock}`,
  );
  return rows[0] === undefined ? null : record(rows[0]);
}

/**
 * بيكتب صف الخانة كله (جديد أو بديل بنفس الـ id) ويصفّر حالة التحقق والفشل. المنادي ماسك قفل بريد
 * العيادة، فخانة جديدة عمرها ما توصل لـ `UNIQUE (clinic_id, slot)`.
 */
export async function upsertMailProvider(
  tx: Tx,
  clinicId: string,
  target: { readonly id: string; readonly slot: MailProviderSlot },
  { fields }: SplitRequest,
  sealed: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const { id, slot } = target;
  await tx.execute(
    sql`INSERT INTO clinic_mail_providers (clinic_id, id, slot, kind, from_name, from_email,
          reply_to, smtp_host, smtp_port, smtp_user, sealed_credentials, verified_at,
          consecutive_failures, degraded_at, last_error, created_at, updated_at)
        VALUES (${clinicId}, ${id}, ${slot}, ${fields.kind}, ${fields.fromName}, ${fields.fromEmail},
          ${fields.replyTo}, ${fields.smtpHost}, ${fields.smtpPort}, ${fields.smtpUser}, ${sealed},
          NULL, 0, NULL, NULL, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT (clinic_id, id) DO UPDATE SET kind = EXCLUDED.kind,
          from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
          reply_to = EXCLUDED.reply_to, smtp_host = EXCLUDED.smtp_host,
          smtp_port = EXCLUDED.smtp_port, smtp_user = EXCLUDED.smtp_user,
          sealed_credentials = EXCLUDED.sealed_credentials, verified_at = NULL,
          consecutive_failures = 0, degraded_at = NULL, last_error = NULL,
          version = clinic_mail_providers.version + 1, updated_at = EXCLUDED.updated_at`,
  );
}

/** بيشيل صف الإعداد (مش بيانات بيزنس، ADR-0014). */
export async function deleteMailProvider(tx: Tx, clinicId: string, id: string): Promise<void> {
  await tx.execute(
    sql`DELETE FROM clinic_mail_providers WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/**
 * قفل إعداد بريد العيادة (الخانتين): كل كتابة (إنشاء، استبدال، حذف، طلب تجربة) بتاخده الأول، فأول
 * إنشاء من أدمنين في نفس اللحظة مايوصلش لـ `UNIQUE (clinic_id, slot)`، وقواعد الخانتين (الاحتياطي
 * محتاج أساسي) وقرار حد التجربة مايتعدّوش بالتوازي.
 */
export async function lockClinicMailProvider(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail_provider:${clinicId}`}, 0))`,
  );
}

/**
 * آخر طلب تجربة اتقبل للعيادة، من سجل التدقيق: append-only، فاستبدال الإعداد أو حذفه مايصفّرش الحد.
 */
export async function lastTestRequestedAt(tx: Tx, clinicId: string): Promise<Date | null> {
  const rows = await tx.execute<{ created_at: string }>(
    sql`SELECT created_at::text AS created_at FROM audit_log
        WHERE clinic_id = ${clinicId} AND action = 'clinic.mail_provider_test_requested'
        ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] === undefined ? null : new Date(rows[0].created_at);
}
