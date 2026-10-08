import type {
  ClinicSettingsRequest,
  ClinicSettingsResponse,
} from "@eyadex/contracts/settings-http";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { sql } from "drizzle-orm";

import { scrubAuditName } from "../../../../shared/audit-name-scrub.ts";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../ports/clock.ts";

/** اللي الـ use case محتاجه: pool العيادة، الوقت، والـ ids. */
export interface ClinicSettingsChangesDeps {
  /** الـ pool على `eyadex_app` (UPDATE على 5 أعمدة من صف العيادة نفسها بس، 0036). */
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** مين بيعدّل: العيادة من الجلسة، والعضو. */
export interface ClinicSettingsActor {
  readonly clinicId: string;
  readonly userId: string;
}

interface SettingsRow {
  name_ar: string;
  name_en: string;
  default_language: "ar" | "en";
  timezone: string;
  slug: string;
  specialty: ClinicSettingsResponse["specialty"];
}

const toView = (row: SettingsRow): ClinicSettingsResponse => ({
  nameAr: row.name_ar,
  nameEn: row.name_en,
  defaultLanguage: row.default_language,
  timezone: row.timezone,
  slug: row.slug,
  specialty: row.specialty,
});

// PRD §4.11: before/after is an allowlist; the names are text a person typed.
const snapshot = (v: ClinicSettingsResponse) => ({
  nameAr: scrubAuditName(v.nameAr),
  nameEn: scrubAuditName(v.nameEn),
  defaultLanguage: v.defaultLanguage,
  timezone: v.timezone,
});

async function readRow(tx: Tx, clinicId: string, lock: boolean): Promise<ClinicSettingsResponse> {
  const rows = await tx.execute<SettingsRow>(
    lock
      ? sql`SELECT name_ar, name_en, default_language, timezone, slug, specialty FROM clinics
            WHERE id = ${clinicId} FOR UPDATE`
      : sql`SELECT name_ar, name_en, default_language, timezone, slug, specialty FROM clinics
            WHERE id = ${clinicId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new ApiError("not_found");
  return toView(row);
}

/**
 * إعدادات العيادة (story 55، ADR-0020): العيادة بتغيّر اسميها ولغتها الافتراضية ومنطقتها الزمنية
 * بس. الحالة والانتهاء والحدود والـ slug للمنصة. كل حاجة جوه `withTenant` على صف العيادة نفسها؛
 * إبطال كاش الصلاحيات بعد الـ commit عند المنادي.
 */
export class ClinicSettingsChanges {
  constructor(private readonly deps: ClinicSettingsChangesDeps) {}

  /**
   * الإعدادات الحالية.
   *
   * @param clinicId العيادة من الجلسة
   * @returns الإعدادات
   */
  read(clinicId: string): Promise<ClinicSettingsResponse> {
    return this.deps.db.withTenant(clinicId, (tx) => readRow(tx, clinicId, false));
  }

  /**
   * يحفظ الإعدادات ويكتب سطر `clinic.settings_updated` في سجل العيادة.
   *
   * @param actor العيادة والعضو
   * @param input القيم بعد الـ contract
   * @returns الإعدادات بعد الحفظ
   */
  update(
    actor: ClinicSettingsActor,
    input: ClinicSettingsRequest,
  ): Promise<ClinicSettingsResponse> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const before = await readRow(tx, actor.clinicId, true);
      const now = clock.now();
      await tx.execute(
        sql`UPDATE clinics SET name_ar = ${input.nameAr}, name_en = ${input.nameEn},
              default_language = ${input.defaultLanguage}, timezone = ${input.timezone},
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${actor.clinicId}`,
      );
      const after: ClinicSettingsResponse = { ...before, ...input };
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "clinic.settings_updated",
        entityType: "clinic",
        entityId: actor.clinicId,
        details: { before: snapshot(before), after: snapshot(after) },
        createdAt: now,
      });
      return after;
    });
  }
}
