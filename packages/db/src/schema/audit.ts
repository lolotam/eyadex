import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0011, 0012, 0013. Append-only: no runtime role can update or delete these rows.
const tz = { withTimezone: true, mode: "date" } as const;

export const auditLog = pgTable(
  "audit_log",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    action: text("action").notNull(),
    category: text("category", { enum: ["administrative", "patient_access"] }).notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    branchId: uuid("branch_id"),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "audit_log_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "audit_log_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    check(
      "audit_log_patient_events_are_patient_access",
      sql`${t.entityType} <> 'patient' OR ${t.category} = 'patient_access'`,
    ),
    index("audit_log_clinic_created_idx").on(t.clinicId, t.createdAt.desc()),
    index("audit_log_clinic_category_created_idx").on(t.clinicId, t.category, t.createdAt.desc()),
    index("audit_log_clinic_entity_idx").on(t.clinicId, t.entityType, t.entityId),
  ],
);

export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id").notNull(),
    action: text("action").notNull(),
    clinicId: uuid("clinic_id"),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    foreignKey({
      name: "platform_audit_log_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    index("platform_audit_log_created_idx").on(t.createdAt.desc()),
    index("platform_audit_log_clinic_idx").on(t.clinicId, t.createdAt.desc()),
  ],
);

/** The platform's only window on clinic audit: administrative, non-patient rows (0013). */
export const platformClinicAdminAudit = pgView("platform_clinic_admin_audit", {
  clinicId: uuid("clinic_id").notNull(),
  id: uuid("id").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  branchId: uuid("branch_id"),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", tz).notNull(),
}).existing();
