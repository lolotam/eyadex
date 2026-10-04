import { describe, expect, it } from "vitest";

import * as db from "../index.ts";

describe("@eyadex/db public surface", () => {
  it("offers createDatabase plus the two error types — no raw client, no Drizzle instance", () => {
    expect(Object.keys(db).sort()).toEqual([
      "DatabaseError",
      "TenantContextViolationError",
      "createDatabase",
    ]);
  });

  it("hands back only the three wrappers plus ping and close", () => {
    const database = db.createDatabase({
      // Nothing listens on port 1: the client is lazy, so building must not reach the network.
      url: "postgres://eyadex_app:unused@127.0.0.1:1/eyadex",
      role: "eyadex_app",
      ids: { newId: () => "01920000-0000-7000-8000-0000000000c1" },
    });
    expect(Object.keys(database).sort()).toEqual([
      "close",
      "ping",
      "withNewTenant",
      "withNoTenant",
      "withTenant",
    ]);
    // No reachable client: a query outside a wrapper would need one of these five.
    for (const value of Object.values(database)) {
      expect(value).toBeTypeOf("function");
    }
  });

  it("names both error classes so a caller can branch on them without matching messages", () => {
    expect(new db.DatabaseError({ code: "23505" }).name).toBe("DatabaseError");
    expect(new db.TenantContextViolationError("clinic").name).toBe("TenantContextViolationError");
  });
});
