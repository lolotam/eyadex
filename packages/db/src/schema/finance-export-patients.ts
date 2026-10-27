import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clinics } from "./clinics.ts";
import { financeReportExportBlobs } from "./finance-reports.ts";
import { tz } from "./finance-columns.ts";

export const financeReportExportPatients = pgTable(
  "finance_report_export_patients",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    exportId: uuid("export_id").notNull(),
    attempt: integer("attempt").notNull(),
    patientId: uuid("patient_id"),
    isComplete: boolean("is_complete").notNull().default(false),
    clearedAt: timestamp("cleared_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "finance_report_export_patients_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "finance_report_export_patients_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "finance_report_export_patients_clinic_id_export_id_attempt_fkey",
      columns: [t.clinicId, t.exportId, t.attempt],
      foreignColumns: [
        financeReportExportBlobs.clinicId,
        financeReportExportBlobs.exportId,
        financeReportExportBlobs.attempt,
      ],
    }),
    index("finance_report_export_patients_attempt_idx").on(t.clinicId, t.exportId, t.attempt),
    uniqueIndex("finance_report_export_patients_member_idx")
      .on(t.clinicId, t.exportId, t.attempt, t.patientId)
      .where(sql.raw("patient_id IS NOT NULL")),
    uniqueIndex("finance_report_export_patients_complete_idx")
      .on(t.clinicId, t.exportId, t.attempt)
      .where(sql.raw("is_complete")),
    check("finance_report_export_patients_attempt_check", sql.raw("(attempt >= 1)")),
    check(
      "finance_report_export_patients_complete_check",
      sql.raw("((NOT is_complete) OR ((patient_id IS NULL) AND (cleared_at IS NULL)))"),
    ),
    check(
      "finance_report_export_patients_cleared_check",
      sql.raw("(is_complete OR ((patient_id IS NULL) = (cleared_at IS NOT NULL)))"),
    ),
  ],
);
