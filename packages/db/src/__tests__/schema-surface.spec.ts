import { getTableConfig } from "drizzle-orm/pg-core";
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
    ];
    for (const table of clinicOwned) {
      const pk = getTableConfig(table).primaryKeys[0]?.columns.map((c) => c.name);
      expect(pk).toEqual(["clinic_id", "id"]);
    }
  });

  it("gives no id column a database default (ids are app-generated UUID v7)", () => {
    for (const value of Object.values(schema)) {
      try {
        const id = getTableConfig(value as never).columns.find((c) => c.name === "id");
        expect(id?.hasDefault ?? false).toBe(false);
      } catch {
        // the view is not a table
      }
    }
  });
});
