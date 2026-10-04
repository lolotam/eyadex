import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.ts";
import { assertNotNested, insideTransaction } from "../nested-guard.ts";

// Nothing listens on port 1, so any query that escaped validation would fail with a connection error
// instead of the TypeError under test.
const UNREACHABLE = "postgres://eyadex_app:unused@127.0.0.1:1/eyadex";
const CLINIC = "01920000-0000-7000-8000-0000000000aa";

const never = (): Promise<never> => {
  throw new Error("fn must never run");
};

const lazy = (role: "eyadex_app" | "eyadex_platform" = "eyadex_app"): Database =>
  createDatabase({
    url: UNREACHABLE,
    role,
    ids: { newId: () => "01920000-0000-7000-8000-0000000000c1" },
  });

describe("clinicId validation", () => {
  it.each([
    ["not-a-uuid"],
    [""],
    ["01920000-0000-7000-8000-0000000000aa "],
    ["01920000-0000-7000-8000-0000000000ag"],
    ["' or 1=1 --"],
  ])("rejects %j asynchronously and never calls fn", async (clinicId) => {
    let called = false;
    const database = lazy();
    await expect(
      database.withTenant(clinicId, () => {
        called = true;
        return never();
      }),
    ).rejects.toThrow(TypeError);
    expect(called).toBe(false);
    await database.close();
  });

  it("rejects an id the generator returned in the wrong shape, before any query", async () => {
    let called = false;
    const database = createDatabase({
      url: UNREACHABLE,
      role: "eyadex_platform",
      ids: { newId: () => "clinic-1" },
    });
    await expect(
      database.withNewTenant(() => {
        called = true;
        return never();
      }),
    ).rejects.toThrow(TypeError);
    expect(called).toBe(false);
    await database.close();
  });
});

describe("withNewTenant is the platform onboarding path", () => {
  it("rejects on eyadex_app without a query", async () => {
    let called = false;
    const database = lazy("eyadex_app");
    await expect(
      database.withNewTenant(() => {
        called = true;
        return never();
      }),
    ).rejects.toThrow(TypeError);
    expect(called).toBe(false);
    await database.close();
  });
});

describe("nested database work is refused", () => {
  it("the marker every wrapper checks is set for the whole async chain", async () => {
    await insideTransaction(async () => {
      expect(() => {
        assertNotNested("withTenant");
      }).toThrow(TypeError);
      // it survives awaits — a use case that awaits before touching the database again
      await Promise.resolve();
      expect(() => {
        assertNotNested("ping");
      }).toThrow(TypeError);
    });
    expect(() => {
      assertNotNested("withTenant");
    }).not.toThrow();
  });

  it("withNoTenant inside withTenant is refused before a connection is taken", async () => {
    const database = lazy();
    // The URL is unreachable, so if the guard let the inner call through it would answer with a
    // connection error instead of the TypeError — the rejection is the proof.
    const failure = await database
      .withNoTenant(async () =>
        database
          .withTenant(CLINIC, () => never())
          .then(() => undefined)
          .catch((error: unknown) => error),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeTypeOf("object");
    await database.close();
  });
});
