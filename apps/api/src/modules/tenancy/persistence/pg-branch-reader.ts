import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { BranchReader, BranchRecord, NameLanguage } from "../ports/branch-reader.ts";

interface BranchRow {
  id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/** `BranchReader` فوق `withTenant`. اللغة bound parameter، مش اسم عمود من المدخلات. */
export class PgBranchReader implements BranchReader {
  constructor(private readonly db: Database) {}

  async listBranches(clinicId: string, language: NameLanguage): Promise<readonly BranchRecord[]> {
    const rows = await this.db.withTenant(clinicId, (tx) =>
      tx.execute<BranchRow>(
        sql`SELECT id, name_ar, name_en, is_active, created_at, updated_at
            FROM branches
            WHERE clinic_id = ${clinicId}
            ORDER BY is_active DESC,
              CASE WHEN ${language} = 'ar' THEN name_ar ELSE name_en END,
              id`,
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      isActive: row.is_active,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));
  }
}
