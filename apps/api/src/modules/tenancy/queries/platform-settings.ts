import type { PlatformSettings } from "@eyadex/contracts/platform";
import type { Database, Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

interface SettingsRow {
  default_trial_days: number;
  alert_days_before_expiry: number;
  email_sender_name: string;
  default_max_users: number;
  default_max_branches: number;
  default_module_patients: boolean;
  default_module_appointments: boolean;
}

/**
 * يقرا إعدادات المنصة (0036، صف واحد) جوه transaction موجودة. `lock` بيمسك الصف للتعديل.
 *
 * @param tx الـ transaction (المنصة أو العيادة: الاتنين عندهم SELECT)
 * @param lock `FOR UPDATE` لو المنادي هيعدّل
 * @returns الإعدادات
 */
export async function readPlatformSettingsIn(tx: Tx, lock = false): Promise<PlatformSettings> {
  const rows = await tx.execute<SettingsRow>(
    lock
      ? sql`SELECT default_trial_days, alert_days_before_expiry, email_sender_name,
              default_max_users, default_max_branches, default_module_patients,
              default_module_appointments
            FROM platform_settings WHERE id = 1 FOR UPDATE`
      : sql`SELECT default_trial_days, alert_days_before_expiry, email_sender_name,
              default_max_users, default_max_branches, default_module_patients,
              default_module_appointments
            FROM platform_settings WHERE id = 1`,
  );
  const row = rows[0];
  // 0036 seeds the row and nobody can delete it; a missing row is a broken database, not a default.
  if (row === undefined) throw new Error("platform_settings has no row");
  return {
    defaultTrialDays: Number(row.default_trial_days),
    alertDaysBeforeExpiry: Number(row.alert_days_before_expiry),
    emailSenderName: row.email_sender_name,
    defaultMaxUsers: Number(row.default_max_users),
    defaultMaxBranches: Number(row.default_max_branches),
    // One column per module (0041): a module joining the list fails this literal until it is mapped.
    defaultModules: {
      patients: row.default_module_patients,
      appointments: row.default_module_appointments,
      // P2 R2-3: `default_module_medical` arrives with 0047 (P2 Task 4 maps it here). Until then no
      // column holds it and the medical module stays off for every new clinic.
      medical: false,
    },
  };
}

/**
 * يقرا إعدادات المنصة في transaction قصيرة من غير عيادة (الجدول مش جدول عيادة).
 *
 * @param db الـ pool
 * @returns الإعدادات
 */
export function readPlatformSettings(db: Database): Promise<PlatformSettings> {
  return db.withNoTenant((tx) => readPlatformSettingsIn(tx));
}
