import type { Database, Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { ClinicStatus } from "../domain/clinic-access.ts";
import type { ClinicModule } from "../domain/feature-flags.ts";
import type { ClinicReader, ClinicSnapshot } from "../ports/clinic-reader.ts";

interface ClinicRow {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  status: ClinicStatus;
  expires_at: Date | string;
  max_users: number;
  max_branches: number;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

const count = async (tx: Tx, query: ReturnType<typeof sql>): Promise<number> => {
  const rows = await tx.execute<{ total: number }>(query);
  return Number(rows[0]?.total ?? 0);
};

/** `ClinicReader` فوق `withTenant` — RLS بيضمن إن السياق ده مايشوفش غير عيادته. */
export class PgClinicReader implements ClinicReader {
  constructor(private readonly db: Database) {}

  async readSnapshot(clinicId: string): Promise<ClinicSnapshot | null> {
    return this.db.withTenant(clinicId, async (tx) => {
      const clinics = await tx.execute<ClinicRow>(
        sql`SELECT id, slug, name_ar, name_en, status, expires_at, max_users, max_branches
            FROM clinics WHERE id = ${clinicId}`,
      );
      const clinic = clinics[0];
      if (clinic === undefined) return null;
      const features = await tx.execute<{ module: ClinicModule; enabled: boolean }>(
        sql`SELECT module, enabled FROM clinic_features WHERE clinic_id = ${clinicId} ORDER BY module`,
      );
      const activeMemberships = await count(
        tx,
        sql`SELECT count(*)::int AS total FROM memberships
            WHERE clinic_id = ${clinicId} AND status = 'active'`,
      );
      const pending = await tx.execute<{ expires_at: Date | string }>(
        sql`SELECT expires_at FROM invitations WHERE clinic_id = ${clinicId} AND status = 'pending'`,
      );
      const activeBranches = await count(
        tx,
        sql`SELECT count(*)::int AS total FROM branches
            WHERE clinic_id = ${clinicId} AND is_active`,
      );
      return {
        id: clinic.id,
        slug: clinic.slug,
        nameAr: clinic.name_ar,
        nameEn: clinic.name_en,
        status: clinic.status,
        expiresAt: toDate(clinic.expires_at),
        maxUsers: Number(clinic.max_users),
        maxBranches: Number(clinic.max_branches),
        features: features.map((row) => ({ module: row.module, enabled: row.enabled })),
        activeMemberships,
        pendingInvitations: pending.map((row) => ({ expiresAt: toDate(row.expires_at) })),
        activeBranches,
      };
    });
  }
}
