import type { PlatformSettings } from "@eyadex/contracts/platform";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { sql } from "drizzle-orm";

import { scrubAuditName } from "../../../../shared/audit-name-scrub.ts";
import { writePlatformAudit } from "../../../../shared/platform-audit.ts";
import type { Clock } from "../../ports/clock.ts";
import { readPlatformSettingsIn } from "../../queries/platform-settings.ts";

/** اللي الـ use case محتاجه: pool المنصة، الوقت، والـ ids. */
export interface PlatformSettingsChangesDeps {
  /** الـ pool على `eyadex_platform` (UPDATE على قيم `platform_settings` بس، 0036). */
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

// The audit copy of the sender name is free text a person typed.
const audited = (s: PlatformSettings) => ({
  ...s,
  emailSenderName: scrubAuditName(s.emailSenderName),
});

/**
 * إعدادات المنصة (story 26، ADR-0020): الصف الوحيد بيتقفل، القيم بتتكتب، وصف واحد في سجل المنصة
 * بالقبل والبعد. مفيش عيادة: الإعدادات عامة، فالشغل في `withNoTenant`.
 */
export class PlatformSettingsChanges {
  constructor(private readonly deps: PlatformSettingsChangesDeps) {}

  /**
   * يحفظ القيم الجديدة.
   *
   * @param actorUserId عضو فريق المنصة
   * @param input القيم بعد الـ contract
   * @returns القيم بعد الحفظ
   */
  async update(actorUserId: string, input: PlatformSettings): Promise<PlatformSettings> {
    const { db, clock, ids } = this.deps;
    return db.withNoTenant(async (tx) => {
      const before = await readPlatformSettingsIn(tx, true);
      const now = clock.now();
      await tx.execute(
        sql`UPDATE platform_settings SET default_trial_days = ${input.defaultTrialDays},
              alert_days_before_expiry = ${input.alertDaysBeforeExpiry},
              email_sender_name = ${input.emailSenderName},
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id = 1`,
      );
      await writePlatformAudit(tx, {
        id: ids.newId(),
        actorUserId,
        action: "platform.settings_updated",
        clinicId: null,
        details: { before: audited(before), after: audited(input) },
        createdAt: now,
      });
      return { ...input };
    });
  }
}
