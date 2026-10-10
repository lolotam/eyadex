import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { memberships } from "./memberships.ts";
import { patients } from "./patients.ts";
import { clinicServices } from "./scheduling.ts";

// Mirror of db/sql/0043 (ADR-0026 §11). Clinic table: forced RLS, eyadex_app only, never deleted.
const tz = { withTimezone: true, mode: "date" } as const;

export const appointments = pgTable(
  "appointments",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    providerMembershipId: uuid("provider_membership_id").notNull(),
    serviceId: uuid("service_id"),
    startsAt: timestamp("starts_at", tz).notNull(),
    endsAt: timestamp("ends_at", tz).notNull(),
    status: text("status", {
      enum: ["booked", "arrived", "completed", "no_show", "cancelled"],
    }).notNull(),
    overbooked: boolean("overbooked").notNull(),
    cancelReason: text("cancel_reason", {
      enum: ["patient_cancelled", "provider_cancelled", "other"],
    }),
    cancelNote: text("cancel_note"),
    // The actor's user id; no foreign key (ADR-0027).
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "appointments_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "appointments_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "appointments_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    foreignKey({
      name: "appointments_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "appointments_clinic_id_provider_membership_id_fkey",
      columns: [t.clinicId, t.providerMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    foreignKey({
      name: "appointments_clinic_id_service_id_fkey",
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [clinicServices.clinicId, clinicServices.id],
    }),
    index("appointments_clinic_provider_starts_idx").on(
      t.clinicId,
      t.providerMembershipId,
      t.startsAt,
    ),
    index("appointments_clinic_branch_starts_idx").on(t.clinicId, t.branchId, t.startsAt),
    index("appointments_clinic_patient_idx").on(t.clinicId, t.patientId),
    index("appointments_clinic_service_idx").on(t.clinicId, t.serviceId),
    index("appointments_clinic_provider_patient_live_idx")
      .on(t.clinicId, t.providerMembershipId, t.patientId)
      .where(sql`status <> 'cancelled'::text`),
    check(
      "appointments_status_check",
      sql.raw(
        "(status = ANY (ARRAY['booked'::text, 'arrived'::text, 'completed'::text, 'no_show'::text, 'cancelled'::text]))",
      ),
    ),
    check(
      "appointments_cancel_reason_check",
      sql.raw(
        "(cancel_reason = ANY (ARRAY['patient_cancelled'::text, 'provider_cancelled'::text, 'other'::text]))",
      ),
    ),
    check("appointments_cancel_note_check", sql.raw("(char_length(cancel_note) <= 200)")),
    check(
      "appointments_interval_check",
      sql.raw(
        "(((ends_at - starts_at) >= '00:05:00'::interval) AND ((ends_at - starts_at) <= '08:00:00'::interval))",
      ),
    ),
    check(
      "appointments_cancelled_check",
      sql.raw("((status = 'cancelled'::text) = (cancel_reason IS NOT NULL))"),
    ),
  ],
);
