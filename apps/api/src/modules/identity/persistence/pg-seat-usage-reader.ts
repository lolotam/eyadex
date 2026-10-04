import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { SeatUsage, SeatUsageReader } from "../../tenancy/index.ts";

/**
 * تنفيذ `identity` للـ port بتاع `tenancy`: `identity` بيملك `memberships` و`invitations`، فهو اللي
 * بيعدّهم (CLAUDE.architecture.md §2.2: القراءة بين الموديولات = port من المستهلك وadapter عند
 * المالك). العدّ كله في الداتابيز والوقت `now` parameter مربوط، فالدعوات المنتهية اللي لسه
 * حالتها المخزّنة `pending` ما بتتحمّلش خالص — مهما اتراكمت.
 */
export class PgSeatUsageReader implements SeatUsageReader {
  constructor(private readonly db: Database) {}

  /**
   * يعدّ العضويات النشطة والدعوات السارية للعيادة في سياقها (RLS).
   *
   * @param clinicId uuid العيادة
   * @param now الوقت الحالي من الـ Clock: الدعوة سارية طول ما `expires_at > now`
   * @returns العدّين
   */
  async readSeatUsage(clinicId: string, now: Date): Promise<SeatUsage> {
    // A Date cannot be a bound parameter of tx.execute (postgres.js unsafe() sends every parameter as
    // text), so the instant travels as an ISO-8601 string with an explicit cast.
    return this.db.withTenant(clinicId, async (tx) => {
      const rows = await tx.execute<{ members: number; invitations: number }>(
        sql`SELECT
              (SELECT count(*)::int FROM memberships
                WHERE clinic_id = ${clinicId} AND status = 'active') AS members,
              (SELECT count(*)::int FROM invitations
                WHERE clinic_id = ${clinicId} AND status = 'pending'
                  AND expires_at > ${now.toISOString()}::timestamptz) AS invitations`,
      );
      const row = rows[0];
      return {
        activeMemberships: Number(row?.members ?? 0),
        livePendingInvitations: Number(row?.invitations ?? 0),
      };
    });
  }
}
