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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0004, 0007, 0008, 0018, 0020.
const tz = { withTimezone: true, mode: "date" } as const;

export const roles = pgTable(
  "roles",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    systemKey: text("system_key", {
      enum: ["clinic_admin", "doctor", "receptionist", "technician"],
    }),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isLocked: boolean("is_locked").notNull(),
    isActive: boolean("is_active").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "roles_pkey", columns: [t.clinicId, t.id] }),
    unique("roles_clinic_id_system_key_key").on(t.clinicId, t.systemKey),
    foreignKey({
      name: "roles_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    uniqueIndex("roles_name_ar_unique").on(t.clinicId, sql`lower(btrim(${t.nameAr}))`),
    uniqueIndex("roles_name_en_unique").on(t.clinicId, sql`lower(btrim(${t.nameEn}))`),
    check(
      "roles_system_key_check",
      sql.raw(
        "(system_key = ANY (ARRAY['clinic_admin'::text, 'doctor'::text, 'receptionist'::text, 'technician'::text]))",
      ),
    ),
  ],
);

/** Global catalog, not clinic-owned (0007). */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    module: text("module", { enum: ["patients", "appointments", "medical"] }),
  },
  (t) => [
    unique("permissions_key_key").on(t.key),
    check(
      "permissions_key_check",
      sql.raw(
        "(key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules|visits|medical|medicines|invoices|discounts|prices):(clinic|branch|own)$'::text)",
      ),
    ),
    check(
      "permissions_module_check",
      sql.raw(
        "(module = ANY (ARRAY['patients'::text, 'appointments'::text, 'medical'::text, 'finance'::text]))",
      ),
    ),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    roleId: uuid("role_id").notNull(),
    permissionId: uuid("permission_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "role_permissions_pkey", columns: [t.clinicId, t.id] }),
    unique("role_permissions_clinic_id_role_id_permission_id_key").on(
      t.clinicId,
      t.roleId,
      t.permissionId,
    ),
    foreignKey({
      name: "role_permissions_permission_id_fkey",
      columns: [t.permissionId],
      foreignColumns: [permissions.id],
    }),
    foreignKey({
      name: "role_permissions_clinic_id_role_id_fkey",
      columns: [t.clinicId, t.roleId],
      foreignColumns: [roles.clinicId, roles.id],
    }),
    index("role_permissions_permission_id_idx").on(t.permissionId),
  ],
);
