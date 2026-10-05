import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Mirror of db/sql/0023 (Better Auth tables). Property names are the camelCase field names Better
// Auth's Drizzle adapter expects; the columns stay snake_case.
const tz = { withTimezone: true, mode: "date" } as const;

export const authUsers = pgTable(
  "auth_users",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull(),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled"),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [unique("auth_users_email_key").on(t.email)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    area: text("area").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    unique("auth_sessions_token_key").on(t.token),
    check(
      "auth_sessions_area_check",
      sql.raw("(area = ANY (ARRAY['platform'::text, 'clinic'::text]))"),
    ),
    index("auth_sessions_user_id_idx").on(t.userId),
    foreignKey({
      name: "auth_sessions_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    unique("auth_accounts_provider_id_account_id_key").on(t.providerId, t.accountId),
    index("auth_accounts_user_id_idx").on(t.userId),
    foreignKey({
      name: "auth_accounts_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

export const authTwoFactors = pgTable(
  "auth_two_factors",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull(),
    failedVerificationCount: integer("failed_verification_count").notNull(),
    lockedUntil: timestamp("locked_until", tz),
  },
  (t) => [
    unique("auth_two_factors_user_id_key").on(t.userId),
    foreignKey({
      name: "auth_two_factors_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [authUsers.id],
    }),
  ],
);
