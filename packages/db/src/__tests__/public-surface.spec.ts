import { describe, expect, it } from "vitest";

import * as db from "../index.ts";

describe("@eyadex/db public surface", () => {
  it("offers the two factories, the three error types and the sql tag — no raw client, no Drizzle instance", () => {
    expect(Object.keys(db).sort()).toEqual([
      "DatabaseError",
      "ForbiddenStatementError",
      "TenantContextViolationError",
      "createDatabase",
      "createDispatcherOutbox",
      "sql",
    ]);
  });

  it("gives the dispatcher a claim, a fixed purge, ping and close only — no general transaction", () => {
    const outbox = db.createDispatcherOutbox({
      url: "postgres://eyadex_dispatcher:unused@127.0.0.1:1/eyadex",
    });
    expect(Object.keys(outbox).sort()).toEqual(["claimNext", "close", "ping", "purgeExpired"]);
  });

  it("refuses dispatcher options out of range before connecting", () => {
    const url = "postgres://eyadex_dispatcher:unused@127.0.0.1:1/eyadex";
    expect(() => db.createDispatcherOutbox({ url: "" })).toThrow(TypeError);
    expect(() => db.createDispatcherOutbox({ url, maxConnections: 0 })).toThrow(TypeError);
    expect(() => db.createDispatcherOutbox({ url, transactionTimeoutMs: 10 })).toThrow(TypeError);
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

  it("names every error class so a caller can branch on them without matching messages", () => {
    expect(new db.DatabaseError({ code: "23505" }).name).toBe("DatabaseError");
    expect(new db.TenantContextViolationError("clinic").name).toBe("TenantContextViolationError");
    // A TypeError, because a forbidden statement is a programming error, not a database failure.
    expect(new db.ForbiddenStatementError("COMMIT")).toBeInstanceOf(TypeError);
    expect(new db.ForbiddenStatementError("COMMIT").name).toBe("ForbiddenStatementError");
    expect(new db.ForbiddenStatementError("COMMIT").keyword).toBe("COMMIT");
  });
});
