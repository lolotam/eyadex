import { foreignKey, pgTable, primaryKey, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0038 (ADR-0020). A clinic table: forced RLS; once per clinic per expiry date.
const tz = { withTimezone: true, mode: "date" } as const;

export const clinicExpiryReminders = pgTable(
  "clinic_expiry_reminders",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_expiry_reminders_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_expiry_reminders_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique("clinic_expiry_reminders_once").on(t.clinicId, t.expiresAt),
  ],
);
