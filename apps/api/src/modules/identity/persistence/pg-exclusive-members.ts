import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import type { ExclusiveMember, ExclusiveMemberReader } from "../../tenancy/index.ts";

// Active, branch-limited members assigned to `branch` and to no OTHER active branch (ADR-0012).
const exclusiveTo = (branch: SQL) => sql`m.status = 'active' AND NOT m.all_branches
  AND EXISTS (SELECT 1 FROM membership_branches mb
              WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id AND mb.branch_id = ${branch})
  AND NOT EXISTS (SELECT 1 FROM membership_branches mb
                  JOIN branches ob ON ob.clinic_id = mb.clinic_id AND ob.id = mb.branch_id
                  WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id
                    AND mb.branch_id <> ${branch} AND ob.is_active)`;

/** تنفيذ `identity` لـ port بتاع `tenancy`: `identity` بيملك العضويات وفروعها. */
export class PgExclusiveMembers implements ExclusiveMemberReader {
  async members(tx: Tx, clinicId: string, branchId: string): Promise<readonly ExclusiveMember[]> {
    const rows = await tx.execute<{ id: string; full_name: string }>(
      sql`SELECT m.id, m.full_name FROM memberships m
          WHERE m.clinic_id = ${clinicId} AND ${exclusiveTo(sql`${branchId}::uuid`)}
          ORDER BY m.id`,
    );
    return rows.map((row) => ({ id: row.id, fullName: row.full_name }));
  }

  async counts(
    tx: Tx,
    clinicId: string,
    branchIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (branchIds.length === 0) return new Map();
    // A JSON list, not an array parameter: tx.execute sends every parameter as text.
    const rows = await tx.execute<{ id: string; n: number }>(
      sql`SELECT b.id,
                 (SELECT count(*)::int FROM memberships m
                   WHERE m.clinic_id = b.clinic_id AND ${exclusiveTo(sql`b.id`)}) AS n
          FROM branches b
          WHERE b.clinic_id = ${clinicId}
            AND b.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(branchIds)}::jsonb))`,
    );
    return new Map(rows.map((row) => [row.id, Number(row.n)]));
  }
}
