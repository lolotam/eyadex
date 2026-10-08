import { daysUntil } from "@eyadex/contracts/platform";
import type { PlatformOverviewResponse } from "@eyadex/contracts/platform-console";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { ClinicStatus } from "../domain/clinic-access.ts";
import type { Clock } from "../ports/clock.ts";
import { effectiveStatusSql } from "./effective-status.ts";
import { readPlatformSettingsIn } from "./platform-settings.ts";

// The overview names a bounded list; the counts above it stay complete.
const EXPIRING_LIMIT = 100;

interface ExpiringRow {
  id: string;
  name_ar: string;
  name_en: string;
  status: ClinicStatus;
  expires_at: Date | string;
}

/**
 * نظرة عامة على المنصة (stories 3–4، ADR-0020): عدد العيادات بكل حالة فعلية، واللي هتنتهي في
 * نافذة التنبيه (مش موقوفة و `now < expires_at <= now + أيام التنبيه`)، الأقرب الأول. أسماء وحالات
 * وتواريخ بس — مفيش أي بيانات مراجعين، والدور `eyadex_platform` مالوش grant عليهم أصلاً.
 *
 * @param db الـ pool على `eyadex_platform`
 * @param clock الـ Clock المحقون
 * @returns النظرة العامة
 */
export async function readPlatformOverview(
  db: Database,
  clock: Clock,
): Promise<PlatformOverviewResponse> {
  const now = clock.now();
  const at = now.toISOString();
  return db.withNoTenant(async (tx) => {
    const settings = await readPlatformSettingsIn(tx);
    const grouped = await tx.execute<{ effective: string; n: number }>(
      sql`SELECT ${effectiveStatusSql(now)} AS effective, count(*)::int AS n
          FROM clinics GROUP BY 1`,
    );
    const expiring = await tx.execute<ExpiringRow>(
      sql`SELECT id, name_ar, name_en, status, expires_at FROM clinics
          WHERE status <> 'suspended' AND expires_at > ${at}::timestamptz
            AND expires_at <= ${at}::timestamptz
              + make_interval(days => ${settings.alertDaysBeforeExpiry}::int)
          ORDER BY expires_at, id
          LIMIT ${EXPIRING_LIMIT}`,
    );
    const counts = { trial: 0, active: 0, suspended: 0, expired: 0 };
    for (const row of grouped) {
      if (row.effective in counts) counts[row.effective as keyof typeof counts] = Number(row.n);
    }
    return {
      counts,
      alertDaysBeforeExpiry: settings.alertDaysBeforeExpiry,
      expiringSoon: expiring.map((row) => {
        const expiresAt = new Date(row.expires_at).toISOString();
        return {
          id: row.id,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          status: row.status,
          expiresAt,
          daysLeft: daysUntil(expiresAt, now.getTime()),
        };
      }),
    };
  });
}
