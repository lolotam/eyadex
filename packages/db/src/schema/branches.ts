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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0003 + 0028 (address, phone).
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
    address: text("address"),
    phone: text("phone"),
    // 0060 (finance R1-9): locks after the branch's first invoice.
    invoicePrefix: text("invoice_prefix"),
  },
  (t) => [
    primaryKey({ name: "branches_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "branches_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    index("branches_clinic_active_idx").on(t.clinicId, t.isActive),
    uniqueIndex("branches_clinic_invoice_prefix_unique")
      .on(t.clinicId, t.invoicePrefix)
      .where(sql.raw("invoice_prefix IS NOT NULL")),
    check("branches_invoice_prefix_check", sql.raw("(invoice_prefix ~ '^[A-Z0-9]{2,6}$'::text)")),
  ],
);
