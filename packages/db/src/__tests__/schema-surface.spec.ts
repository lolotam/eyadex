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
});
