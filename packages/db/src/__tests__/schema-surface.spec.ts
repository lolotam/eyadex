import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../schema/index.ts";

describe("@eyadex/db/schema", () => {
  it("exports table definitions only — nothing callable that could reach the database", () => {
    for (const value of Object.values(schema)) {
      expect(typeof value).toBe("object");
    }
  });

  it("gives every clinic-owned table a (clinic_id, id) primary key", () => {
    const clinicOwned = [
      schema.clinicFeatures,
      schema.branches,
      schema.roles,
      schema.rolePermissions,
      schema.memberships,
      schema.membershipBranches,
      schema.invitations,
      schema.invitationBranches,
      schema.patients,
      schema.auditLog,
      schema.clinicServices,
      schema.providerSchedules,
      schema.providerTimeOff,
      schema.appointments,
      schema.visits,
      schema.visitNotes,
      schema.visitAddenda,
      schema.patientMedicalProfiles,
      schema.visitDiagnoses,
      schema.visitPrescriptionItems,
      schema.clinicMedicines,
      schema.patientAttachments,
      schema.clinicNotificationSettings,
      schema.patientNotifications,
      schema.clinicWhatsappChannels,
      schema.usedInvoicePrefixes,
      schema.serviceProviderPrices,
      schema.invoiceSequences,
      schema.invoices,
      schema.invoiceLines,
      schema.invoiceLinks,
      schema.clinicPaymentMethods,
      schema.receiptSequences,
      schema.payments,
      schema.paymentAllocations,
      schema.patientCredits,
      schema.refunds,
      schema.refundSources,
      schema.cashClosings,
      schema.branchCashDrawers,
    ];
    for (const table of clinicOwned) {
      const pk = getTableConfig(table).primaryKeys[0]?.columns.map((c) => c.name);
      expect(pk).toEqual(["clinic_id", "id"]);
    }
  });

  it("gives no id column a database default (ids are app-generated UUID v7)", () => {
    // Tables are picked out first: the assertion must never sit inside a catch that could swallow
    // its failure (Codex on PR #24).
    const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
      is(value, PgTable),
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const id = getTableConfig(table).columns.find((c) => c.name === "id");
      if (id === undefined) continue;
      expect([id.hasDefault, id.default]).toEqual([false, undefined]);
    }
  });

  it("reads every money column as a JS bigint, never a lossy number (finance R1-1)", () => {
    const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
      is(value, PgTable),
    );
    const money = tables.flatMap((table) =>
      getTableConfig(table).columns.filter((c) => c.name.endsWith("_minor")),
    );
    expect(money.length).toBeGreaterThan(0);
    for (const column of money)
      expect([column.name, column.dataType]).toEqual([column.name, "bigint"]);
  });

  it("mirrors N3's delivery times and the one-clinic-per-Meta-number index (0059)", () => {
    const ledger = getTableConfig(schema.patientNotifications).columns.map((c) => c.name);
    expect(ledger).toEqual(expect.arrayContaining(["delivered_at", "read_at"]));
    const unique = getTableConfig(schema.clinicWhatsappChannels).indexes.find(
      (i) => i.config.name === "clinic_whatsapp_channels_phone_number_unique",
    );
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((c) => (c as { name?: string }).name)).toEqual([
      "phone_number_id",
    ]);
    expect(unique?.config.where).toBeDefined();
  });
});
