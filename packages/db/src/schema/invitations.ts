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

// Mirror of db/sql/0009, 0014, 0020. Only the token hash is ever stored.
const tz = { withTimezone: true, mode: "date" } as const;

export const invitations = pgTable(
  "invitations",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    roleId: uuid("role_id").notNull(),
    allBranches: boolean("all_branches").notNull(),
    status: text("status", { enum: ["pending", "accepted", "cancelled"] }).notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    respondedAt: timestamp("responded_at", tz),
  },
  (t) => [
    primaryKey({ name: "invitations_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "invitations_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "invitations_clinic_id_role_id_fkey",
      columns: [t.clinicId, t.roleId],
      foreignColumns: [roles.clinicId, roles.id],
    }),
    index("invitations_clinic_status_idx").on(t.clinicId, t.status, t.expiresAt),
    index("invitations_clinic_email_idx").on(t.clinicId, sql`lower(${t.email})`),
    index("invitations_clinic_id_role_id_idx").on(t.clinicId, t.roleId),
    uniqueIndex("invitations_token_hash_idx").on(t.tokenHash),
    check("invitations_email_canonical", sql.raw("(email = lower(btrim(email)))")),
    check(
      "invitations_status_check",
      sql.raw("(status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text]))"),
    ),
  ],
);

export const invitationBranches = pgTable(
  "invitation_branches",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    invitationId: uuid("invitation_id").notNull(),
    branchId: uuid("branch_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "invitation_branches_pkey", columns: [t.clinicId, t.id] }),
    unique("invitation_branches_clinic_id_invitation_id_branch_id_key").on(
      t.clinicId,
      t.invitationId,
      t.branchId,
    ),
    foreignKey({
      name: "invitation_branches_clinic_id_invitation_id_fkey",
      columns: [t.clinicId, t.invitationId],
      foreignColumns: [invitations.clinicId, invitations.id],
    }),
    foreignKey({
      name: "invitation_branches_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    index("invitation_branches_clinic_branch_idx").on(t.clinicId, t.branchId),
  ],
);
