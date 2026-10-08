import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirror of db/sql/0037 (ADR-0020). The platform team: global, eyadex_platform only, link hash only.
const tz = { withTimezone: true, mode: "date" } as const;

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").unique("platform_accounts_user_id_key"),
    email: text("email").notNull().unique("platform_accounts_email_key"),
    fullName: text("full_name").notNull(),
    status: text("status").notNull(),
    tokenHash: text("token_hash").unique("platform_accounts_token_hash_key"),
    tokenExpiresAt: timestamp("token_expires_at", tz),
    invitedBy: uuid("invited_by"),
    joinedAt: timestamp("joined_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    index("platform_accounts_created_idx").on(t.createdAt, t.id),
    check(
      "platform_accounts_email_check",
      sql.raw("((email = lower(btrim(email))) AND (email <> ''::text))"),
    ),
    check(
      "platform_accounts_full_name_check",
      sql.raw("((char_length(full_name) >= 1) AND (char_length(full_name) <= 100))"),
    ),
    check(
      "platform_accounts_status_check",
      sql.raw("(status = ANY (ARRAY['invited'::text, 'active'::text, 'deactivated'::text]))"),
    ),
    check("platform_accounts_token_hash_check", sql.raw("(token_hash ~ '^[0-9a-f]{64}$'::text)")),
    check(
      "platform_accounts_token_pair",
      sql.raw("((token_hash IS NULL) = (token_expires_at IS NULL))"),
    ),
    check("platform_accounts_joined_link", sql.raw("((joined_at IS NULL) = (user_id IS NULL))")),
    check(
      "platform_accounts_active_joined",
      sql.raw("((status <> 'active'::text) OR (joined_at IS NOT NULL))"),
    ),
  ],
);
