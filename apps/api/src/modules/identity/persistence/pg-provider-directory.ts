import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** A member as the appointments module reads it (its `ProviderDirectory` port, ADR-0026 §2). */
export interface ProviderRow {
  readonly membershipId: string;
  readonly fullName: string;
  readonly active: boolean;
  readonly acceptsAppointments: boolean;
  readonly defaultDurationMinutes: number;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

interface Raw {
  id: string;
  full_name: string;
  status: "active" | "deactivated";
  accepts_appointments: boolean;
  default_duration_minutes: number;
  all_branches: boolean;
  branch_ids: string[] | null;
}

const SELECT = sql`SELECT m.id, m.full_name, m.status, m.accepts_appointments,
    m.default_duration_minutes, m.all_branches,
    (SELECT jsonb_agg(mb.branch_id ORDER BY mb.branch_id) FROM membership_branches mb
      WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id) AS branch_ids
  FROM memberships m`;

const toRow = (row: Raw): ProviderRow => ({
  membershipId: row.id,
  fullName: row.full_name,
  active: row.status === "active",
  acceptsAppointments: row.accepts_appointments,
  defaultDurationMinutes: Number(row.default_duration_minutes),
  allBranches: row.all_branches,
  branchIds: row.branch_ids ?? [],
});

/**
 * identity's adapter for the appointments module's `ProviderDirectory` port: reads memberships inside
 * the appointments transaction, so the module never names identity's tables (apps/api/AGENTS.md).
 */
export class PgProviderDirectory {
  async find(tx: Tx, clinicId: string, membershipId: string): Promise<ProviderRow | null> {
    const rows = await tx.execute<Raw>(
      sql`${SELECT} WHERE m.clinic_id = ${clinicId} AND m.id = ${membershipId}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async listBookable(tx: Tx, clinicId: string): Promise<readonly ProviderRow[]> {
    const rows = await tx.execute<Raw>(
      sql`${SELECT} WHERE m.clinic_id = ${clinicId} AND m.status = 'active'
            AND m.accepts_appointments ORDER BY m.full_name, m.id`,
    );
    return rows.map(toRow);
  }
}
