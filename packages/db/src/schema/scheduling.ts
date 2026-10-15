import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { memberships } from "./memberships.ts";

// Mirror of db/sql/0042 (ADR-0026). Clinic tables: forced RLS, eyadex_app only.
const tz = { withTimezone: true, mode: "date" } as const;

export const clinicServices = pgTable(
  "clinic_services",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
    // 0060 (finance FIN-A8): the base price, NULL until set; capped at the line cap.
    priceMinor: bigint("price_minor", { mode: "bigint" }),
  },
  (t) => [
    primaryKey({ name: "clinic_services_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_services_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    uniqueIndex("clinic_services_name_ar_unique").on(t.clinicId, sql`lower(btrim(${t.nameAr}))`),
    uniqueIndex("clinic_services_name_en_unique").on(t.clinicId, sql`lower(btrim(${t.nameEn}))`),
    index("clinic_services_clinic_status_idx").on(t.clinicId, t.status),
    check(
      "clinic_services_duration_minutes_check",
      sql.raw("((duration_minutes >= 5) AND (duration_minutes <= 480))"),
    ),
    check(
      "clinic_services_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'inactive'::text]))"),
    ),
    check(
      "clinic_services_price_minor_check",
      sql.raw("((price_minor >= 0) AND (price_minor <= '1000000000000'::bigint))"),
    ),
  ],
);

export const providerSchedules = pgTable(
  "provider_schedules",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    weekday: smallint("weekday").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "provider_schedules_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "provider_schedules_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "provider_schedules_clinic_id_membership_id_fkey",
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    foreignKey({
      name: "provider_schedules_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    index("provider_schedules_clinic_membership_weekday_idx").on(
      t.clinicId,
      t.membershipId,
      t.weekday,
    ),
    index("provider_schedules_clinic_branch_idx").on(t.clinicId, t.branchId),
    check("provider_schedules_interval_check", sql.raw("(starts_at < ends_at)")),
    check("provider_schedules_weekday_check", sql.raw("((weekday >= 0) AND (weekday <= 6))")),
  ],
);

export const providerTimeOff = pgTable(
  "provider_time_off",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    startsAt: timestamp("starts_at", tz).notNull(),
    endsAt: timestamp("ends_at", tz).notNull(),
    note: text("note"),
    cancelledAt: timestamp("cancelled_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "provider_time_off_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "provider_time_off_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "provider_time_off_clinic_id_membership_id_fkey",
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    index("provider_time_off_clinic_membership_starts_idx").on(
      t.clinicId,
      t.membershipId,
      t.startsAt,
    ),
    check("provider_time_off_interval_check", sql.raw("(starts_at < ends_at)")),
    check("provider_time_off_note_check", sql.raw("(char_length(note) <= 200)")),
  ],
);
