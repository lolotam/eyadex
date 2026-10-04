import { describe, expect, it } from "vitest";

import { createDatabase, type DatabaseOptions } from "../index.ts";

// The connection string carries a password on purpose: no validation message and no thrown error may
// ever contain it, the host, the user or the database name (CLAUDE.md §8, ADR-0002 rule 7).
const SECRET = "postgres://eyadex_owner:never-log-this-password@db.internal.example:5432/eyadex";
const base: DatabaseOptions = {
  url: SECRET,
  role: "eyadex_app",
  ids: { newId: () => "01920000-0000-7000-8000-0000000000c1" },
};

const rejects = (options: unknown): TypeError => {
  let thrown: unknown;
  try {
    createDatabase(options as DatabaseOptions);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TypeError);
  const message = (thrown as TypeError).message;
  for (const secret of [SECRET, "never-log-this-password", "db.internal.example", "eyadex_owner"]) {
    expect(message).not.toContain(secret);
  }
  return thrown as TypeError;
};

describe("createDatabase option validation", () => {
  it("accepts the minimum valid options", () => {
    expect(() => createDatabase(base)).not.toThrow();
  });

  it("refuses a role outside the two runtime roles", () => {
    expect(rejects({ ...base, role: "eyadex_owner" }).message).toMatch(/options\.role/);
    expect(rejects({ ...base, role: "postgres" }).message).toMatch(/options\.role/);
  });

  it("refuses a missing connection string", () => {
    expect(rejects({ ...base, url: "" }).message).toMatch(/options\.url/);
    expect(rejects({ ...base, url: "   " }).message).toMatch(/options\.url/);
    expect(rejects({ ...base, url: undefined }).message).toMatch(/options\.url/);
  });

  it("refuses a missing id generator", () => {
    expect(rejects({ ...base, ids: undefined }).message).toMatch(/options\.ids/);
    expect(rejects({ ...base, ids: {} }).message).toMatch(/options\.ids/);
  });

  it("refuses a maxConnections outside 1..100", () => {
    expect(rejects({ ...base, maxConnections: 0 }).message).toMatch(/maxConnections/);
    expect(rejects({ ...base, maxConnections: 101 }).message).toMatch(/maxConnections/);
    expect(rejects({ ...base, maxConnections: 2.5 }).message).toMatch(/maxConnections/);
  });

  it("refuses a transactionTimeoutMs outside 1..600000", () => {
    expect(rejects({ ...base, transactionTimeoutMs: 0 }).message).toMatch(/transactionTimeoutMs/);
    expect(rejects({ ...base, transactionTimeoutMs: 600_001 }).message).toMatch(
      /transactionTimeoutMs/,
    );
    expect(rejects({ ...base, transactionTimeoutMs: "5000" }).message).toMatch(
      /transactionTimeoutMs/,
    );
  });
});

describe("createDatabase is lazy", () => {
  it("builds against an unreachable URL without throwing and without connecting", async () => {
    const unreachable = createDatabase({
      url: "postgres://eyadex_app:unused@127.0.0.1:1/eyadex",
      role: "eyadex_app",
      ids: { newId: () => "01920000-0000-7000-8000-0000000000c1" },
    });
    // A connected client would have thrown by now; closing proves nothing was ever opened.
    await expect(unreachable.close()).resolves.toBeUndefined();
  });
});

describe("options are read once", () => {
  it("reads url exactly once, so a getter cannot slip another value past validation", async () => {
    let reads = 0;
    const options = Object.defineProperty({ ...base }, "url", {
      get: () => {
        reads += 1;
        return SECRET;
      },
    }) as DatabaseOptions;
    const built = createDatabase(options);
    expect(reads).toBe(1);
    await expect(built.close()).resolves.toBeUndefined();
  });

  it("rejects the value the getter returned, without ever reading it a second time", () => {
    let reads = 0;
    const options = Object.defineProperty({ ...base, url: undefined }, "url", {
      get: () => {
        reads += 1;
        return undefined;
      },
    }) as unknown as DatabaseOptions;
    expect(rejects(options).message).toMatch(/options\.url/);
    expect(reads).toBe(1);
  });
});
