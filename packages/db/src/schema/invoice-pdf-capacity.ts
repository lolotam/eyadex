import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";

// Catalog mirror of the local-only PDF ledger candidate. SQL remains authoritative.

export const invoicePdfCapacity = pg.pgTable(
  "invoice_pdf_capacity",
  {
    singleton: pg.boolean("singleton").notNull().default(sql.raw("true")),
    admitted: pg.integer("admitted").notNull(),
  },
  (t) => [
    pg.check(
      "invoice_pdf_capacity_admitted_check",
      sql.raw("((admitted >= 0) AND (admitted <= 100))"),
    ),
    pg.primaryKey({ name: "invoice_pdf_capacity_pkey", columns: [t.singleton] }),
    pg.check("invoice_pdf_capacity_singleton_check", sql.raw("singleton")),
  ],
);
