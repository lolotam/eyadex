import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

// Mirror of db/sql/0036, 0041, 0042 and 0046 (ADR-0020, ADR-0026, P2 R2-3). Global configuration: one row, no clinic data, no RLS.
const tz = { withTimezone: true, mode: "date" } as const;

export const platformSettings = pgTable(
  "platform_settings",
  {
    id: smallint("id").primaryKey(),
    defaultTrialDays: integer("default_trial_days").notNull(),
    alertDaysBeforeExpiry: integer("alert_days_before_expiry").notNull(),
    emailSenderName: text("email_sender_name").notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
    defaultMaxUsers: integer("default_max_users").notNull(),
    defaultMaxBranches: integer("default_max_branches").notNull(),
    defaultModulePatients: boolean("default_module_patients").notNull(),
    defaultModuleAppointments: boolean("default_module_appointments").notNull(),
    defaultModuleMedical: boolean("default_module_medical").notNull(),
    defaultModuleFinance: boolean("default_module_finance").notNull(),
  },
  () => [
    check("platform_settings_id_check", sql.raw("(id = 1)")),
    check(
      "platform_settings_default_trial_days_check",
      sql.raw("((default_trial_days >= 1) AND (default_trial_days <= 90))"),
    ),
    check(
      "platform_settings_alert_days_before_expiry_check",
      sql.raw("((alert_days_before_expiry >= 1) AND (alert_days_before_expiry <= 60))"),
    ),
    check(
      "platform_settings_default_max_users_check",
      sql.raw("((default_max_users >= 1) AND (default_max_users <= 1000))"),
    ),
    check(
      "platform_settings_default_max_branches_check",
      sql.raw("((default_max_branches >= 1) AND (default_max_branches <= 100))"),
    ),
    check(
      "platform_settings_email_sender_name_check",
      sql.raw(
        "(((char_length(email_sender_name) >= 2) AND (char_length(email_sender_name) <= 60)) AND (email_sender_name = btrim(email_sender_name)) AND (email_sender_name !~ '[[:cntrl:]]'::text))",
      ),
    ),
  ],
);
