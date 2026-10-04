import { boolean, foreignKey, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0003.
const tz = { withTimezone: true, mode: "date" } as const;

export const branches = pgTable(
  "branches",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isActive: boolean("is_active").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "branches_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({ name: "branches_clinic_id_fkey", columns: [t.clinicId], foreignColumns: [clinics.id] }),
    index("branches_clinic_active_idx").on(t.clinicId, t.isActive),
  ],
);
