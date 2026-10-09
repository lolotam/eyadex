import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0028 + 0040. A clinic table: forced RLS on clinic_id, like every other (ADR-0011).
const tz = { withTimezone: true, mode: "date" } as const;

export const clinicIdempotencyKeys = pgTable(
  "clinic_idempotency_keys",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_idempotency_keys_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_idempotency_keys_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique("clinic_idempotency_keys_scope_key").on(t.clinicId, t.scope, t.key),
    // 0040: the cross-clinic retention purge only (ADR-0022), so it does not start with clinic_id.
    index("clinic_idempotency_keys_created_idx").on(t.createdAt),
    check("clinic_idempotency_keys_scope_check", sql.raw("(scope <> ''::text)")),
    check(
      "clinic_idempotency_keys_key_check",
      sql.raw("((length(key) >= 1) AND (length(key) <= 200))"),
    ),
    check(
      "clinic_idempotency_keys_request_hash_check",
      sql.raw("(request_hash ~ '^[0-9a-f]{64}$'::text)"),
    ),
  ],
);
