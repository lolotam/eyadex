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

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { roles } from "./roles.ts";

// Mirror of db/sql/0005, 0006, 0015, 0017, 0027. user_id is a plain uuid: identity tables arrive later.
const tz = { withTimezone: true, mode: "date" } as const;

export const memberships = pgTable(
  "memberships",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    userId: uuid("user_id").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull(),
    allBranches: boolean("all_branches").notNull(),
    status: text("status", { enum: ["active", "deactivated"] }).notNull(),
    preferredLanguage: text("preferred_language", { enum: ["ar", "en"] }).notNull(),
    lastLoginAt: timestamp("last_login_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "memberships_pkey", columns: [t.clinicId, t.id] }),
    unique("memberships_clinic_id_user_id_key").on(t.clinicId, t.userId),
    foreignKey({
      name: "memberships_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "memberships_clinic_id_role_id_fkey",
      columns: [t.clinicId, t.roleId],
      foreignColumns: [roles.clinicId, roles.id],
    }),
    index("memberships_clinic_role_idx").on(t.clinicId, t.roleId),
    index("memberships_clinic_status_idx").on(t.clinicId, t.status),
    uniqueIndex("memberships_email_unique").on(t.email),
    uniqueIndex("memberships_user_unique").on(t.userId),
    check("memberships_email_canonical", sql.raw("(email = lower(btrim(email)))")),
    check(
      "memberships_preferred_language_check",
      sql.raw("(preferred_language = ANY (ARRAY['ar'::text, 'en'::text]))"),
    ),
    check(
      "memberships_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'deactivated'::text]))"),
    ),
  ],
);

export const membershipBranches = pgTable(
  "membership_branches",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "membership_branches_pkey", columns: [t.clinicId, t.id] }),
    unique("membership_branches_clinic_id_membership_id_branch_id_key").on(
      t.clinicId,
      t.membershipId,
      t.branchId,
    ),
    foreignKey({
      name: "membership_branches_clinic_id_membership_id_fkey",
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    foreignKey({
      name: "membership_branches_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    index("membership_branches_clinic_branch_idx").on(t.clinicId, t.branchId),
  ],
);

/** Global one-email-one-account hold (0015); not clinic-scoped by design. */
export const emailReservations = pgTable(
  "email_reservations",
  {
    email: text("email").primaryKey(),
    kind: text("kind", { enum: ["invitation", "membership", "platform"] }).notNull(),
    clinicId: uuid("clinic_id"),
    invitationId: uuid("invitation_id"),
    expiresAt: timestamp("expires_at", tz),
    reservedAt: timestamp("reserved_at", tz).notNull(),
  },
  (t) => [
    foreignKey({
      name: "email_reservations_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    index("email_reservations_clinic_idx").on(t.clinicId),
    check("email_reservations_check", sql.raw("((kind = 'platform'::text) = (clinic_id IS NULL))")),
    check(
      "email_reservations_check1",
      sql.raw("((kind = 'invitation'::text) = (expires_at IS NOT NULL))"),
    ),
    check(
      "email_reservations_check2",
      sql.raw("((kind = 'invitation'::text) = (invitation_id IS NOT NULL))"),
    ),
    check(
      "email_reservations_email_check",
      sql.raw("((email = lower(btrim(email))) AND (email <> ''::text))"),
    ),
    check(
      "email_reservations_kind_check",
      sql.raw("(kind = ANY (ARRAY['invitation'::text, 'membership'::text, 'platform'::text]))"),
    ),
  ],
);
