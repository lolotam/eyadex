import type { ClinicModule } from "@eyadex/contracts/clinics";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { MemberAccess } from "../domain/member-access.ts";
import type { MemberAccessReader } from "../ports/member-access-reader.ts";

interface MemberRow {
  id: string;
  status: MemberAccess["status"];
  full_name: string;
  email: string;
  preferred_language: MemberAccess["preferredLanguage"];
  all_branches: boolean;
  role_id: string;
  role_name_ar: string;
  role_name_en: string;
  role_active: boolean;
  clinic_name_ar: string;
  clinic_name_en: string;
  timezone: string;
  clinic_status: MemberAccess["clinic"]["status"];
  expires_at: Date | string;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

/** `MemberAccessReader` على `eyadex_app`: الـ lookup من غير عيادة، والباقي جوه `withTenant`. */
export class PgMemberAccessReader implements MemberAccessReader {
  constructor(private readonly db: Database) {}

  async clinicForUser(userId: string): Promise<string | null> {
    return this.db.withNoTenant(async (tx) => {
      const rows = await tx.execute<{ clinic_id: string | null }>(
        sql`SELECT membership_clinic_for_user(${userId}::uuid) AS clinic_id`,
      );
      return rows[0]?.clinic_id ?? null;
    });
  }

  async readMember(clinicId: string, userId: string): Promise<MemberAccess | null> {
    return this.db.withTenant(clinicId, async (tx) => {
      const rows = await tx.execute<MemberRow>(
        sql`SELECT m.id, m.status, m.full_name, m.email, m.preferred_language, m.all_branches,
                   m.role_id, r.name_ar AS role_name_ar, r.name_en AS role_name_en,
                   r.is_active AS role_active, c.name_ar AS clinic_name_ar,
                   c.name_en AS clinic_name_en, c.timezone, c.status AS clinic_status, c.expires_at
            FROM memberships m
            JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
            JOIN clinics c ON c.id = m.clinic_id
            WHERE m.clinic_id = ${clinicId} AND m.user_id = ${userId}`,
      );
      const row = rows[0];
      if (row === undefined) return null;
      const permissions = await tx.execute<{ key: string }>(
        sql`SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.clinic_id = ${clinicId} AND rp.role_id = ${row.role_id} ORDER BY p.key`,
      );
      const branches = row.all_branches
        ? []
        : await tx.execute<{ branch_id: string }>(
            sql`SELECT mb.branch_id FROM membership_branches mb
                JOIN branches b ON b.clinic_id = mb.clinic_id AND b.id = mb.branch_id
                WHERE mb.clinic_id = ${clinicId} AND mb.membership_id = ${row.id} AND b.is_active
                ORDER BY mb.branch_id`,
          );
      const features = await tx.execute<{ module: ClinicModule }>(
        sql`SELECT module FROM clinic_features
            WHERE clinic_id = ${clinicId} AND enabled ORDER BY module`,
      );
      return {
        clinicId,
        membershipId: row.id,
        userId,
        status: row.status,
        fullName: row.full_name,
        email: row.email,
        preferredLanguage: row.preferred_language,
        role: {
          id: row.role_id,
          nameAr: row.role_name_ar,
          nameEn: row.role_name_en,
          isActive: row.role_active,
        },
        permissions: permissions.map((p) => p.key),
        allBranches: row.all_branches,
        branchIds: branches.map((b) => b.branch_id),
        clinic: {
          nameAr: row.clinic_name_ar,
          nameEn: row.clinic_name_en,
          timezone: row.timezone,
          status: row.clinic_status,
          expiresAt: iso(row.expires_at),
          enabledModules: features.map((f) => f.module),
        },
      };
    });
  }
}
