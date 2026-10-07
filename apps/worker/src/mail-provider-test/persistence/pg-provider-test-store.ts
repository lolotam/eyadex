import { sql, type Database } from "@eyadex/db";

import type {
  ProviderTestRecord,
  ProviderTestState,
  ProviderTestStore,
  ProviderUnderTest,
} from "../ports/provider-test-store.ts";

type Row = {
  id: string;
  kind: "resend" | "smtp";
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  sealed_credentials: string;
  updated_at: string;
};

const provider = (row: Row): ProviderUnderTest => ({
  id: row.id,
  kind: row.kind,
  fromName: row.from_name,
  fromEmail: row.from_email,
  replyTo: row.reply_to,
  smtpHost: row.smtp_host,
  smtpPort: row.smtp_port,
  smtpUser: row.smtp_user,
  sealedCredentials: row.sealed_credentials,
  updatedAt: new Date(row.updated_at),
});

/**
 * SQL التجربة على `eyadex_app` تحت `withTenant`: الـ RLS بيقصر الصف والعضوية على عيادة الحدث. الصف
 * ممسوك `FOR UPDATE` لحد نهاية الإرسال، فـ `PUT` أو `DELETE` متزامن بيستنى ومايتكتبش عليه نتيجة قديمة.
 */
export class PgProviderTestStore implements ProviderTestStore {
  constructor(private readonly db: Database) {}

  withProvider(
    clinicId: string,
    providerId: string,
    actorUserId: string,
    use: (state: ProviderTestState) => Promise<ProviderTestRecord | null>,
  ): Promise<void> {
    return this.db.withTenant(clinicId, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id, kind, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
                   sealed_credentials, updated_at
            FROM clinic_mail_providers WHERE clinic_id = ${clinicId} AND id = ${providerId}
            FOR UPDATE`,
      )) as unknown as Row[];
      const members = (await tx.execute(
        sql`SELECT email FROM memberships
            WHERE clinic_id = ${clinicId} AND user_id = ${actorUserId} AND status = 'active'`,
      )) as unknown as { email: string }[];
      const record = await use({
        provider: rows[0] === undefined ? null : provider(rows[0]),
        recipient: members[0]?.email ?? null,
      });
      if (record === null) return;
      if (record.ok) {
        await tx.execute(
          sql`UPDATE clinic_mail_providers SET verified_at = ${record.at.toISOString()}::timestamptz,
                last_error = NULL
              WHERE clinic_id = ${clinicId} AND id = ${providerId}`,
        );
      } else {
        await tx.execute(
          sql`UPDATE clinic_mail_providers SET last_error = ${record.error.slice(0, 120)}
              WHERE clinic_id = ${clinicId} AND id = ${providerId}`,
        );
      }
    });
  }
}
