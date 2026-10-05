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
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0025. Writers append only; the dispatcher reads and marks (ADR-0006).
const tz = { withTimezone: true, mode: "date" } as const;

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    clinicId: uuid("clinic_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    dispatchedAt: timestamp("dispatched_at", tz),
  },
  (t) => [
    foreignKey({
      name: "outbox_events_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    index("outbox_events_clinic_idx").on(t.clinicId),
    index("outbox_events_pending_idx").on(t.createdAt).where(sql`dispatched_at IS NULL`),
    check(
      "outbox_events_event_type_check",
      sql.raw("(event_type ~ '^[a-z]+(_[a-z]+)*\\.[a-z]+(_[a-z]+)*$'::text)"),
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "idempotency_keys_pkey", columns: [t.scope, t.key] }),
    check("idempotency_keys_scope_check", sql.raw("(scope <> ''::text)")),
    check(
      "idempotency_keys_key_check",
      sql.raw("((length(key) >= 1) AND (length(key) <= 200))"),
    ),
    check("idempotency_keys_request_hash_check", sql.raw("(request_hash ~ '^[0-9a-f]{64}$'::text)")),
  ],
);
