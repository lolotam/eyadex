import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { guardTransaction, type RawTx } from "../guarded-tx.ts";

function driver() {
  const unsafe = vi.fn<(text: string) => Promise<unknown[]>>().mockResolvedValue([]);
  const raw = {
    dialect: new PgDialect(),
    session: { client: { unsafe } },
    rollback: () => {},
    transaction: async (fn: (tx: RawTx) => Promise<unknown>) => fn(raw as unknown as RawTx),
  };
  return { unsafe, guarded: guardTransaction(raw as unknown as RawTx) };
}

describe("tenant cursor contract", () => {
  it.each([
    "FOR UPDATE",
    "FOR NO KEY UPDATE",
    "FOR SHARE",
    "FOR KEY SHARE",
    "for\nupdate nowait",
    "FOR/* nested /* comment */ */KEY-- comment\rSHARE SKIP LOCKED",
    "FOR UPDATE OF p",
  ])("rejects %s before sending any driver command", async (clause) => {
    const { unsafe, guarded } = driver();
    await expect(
      guarded.finish((tx) => tx.cursor(sql.raw(`SELECT * FROM patients p ${clause}`))),
    ).rejects.toThrow("row-locking SELECT");
    expect(unsafe).not.toHaveBeenCalled();
  });

  it("does not inspect bound parameter values for locking keywords", async () => {
    const { unsafe, guarded } = driver();
    await guarded.finish(async (tx) => {
      const cursor = await tx.cursor(sql`SELECT ${"FOR UPDATE"} AS label`);
      await cursor.read();
      await cursor.close();
    });
    expect(unsafe.mock.calls.map(([text]) => text.split(" ")[0])).toEqual([
      "DECLARE",
      "FETCH",
      "CLOSE",
    ]);
  });

  it("closes a savepoint cursor before returning to its parent and revokes the handle", async () => {
    const { unsafe, guarded } = driver();
    await guarded.finish(async (tx) => {
      const cursor = await tx.transaction((inner) => inner.cursor(sql`SELECT 1`));
      expect(unsafe.mock.calls.at(-1)?.[0]).toMatch(/^CLOSE /);
      expect(() => cursor.read()).toThrow("no longer valid");
    });
    expect(unsafe.mock.calls.filter(([text]) => text.startsWith("CLOSE"))).toHaveLength(1);
  });

  it("preserves a failed FETCH through unconditional finally cleanup", async () => {
    const { unsafe, guarded } = driver();
    unsafe.mockImplementation(async (text) => {
      if (text.startsWith("FETCH"))
        throw Object.assign(new Error("query cancelled"), { code: "57014" });
      if (text.startsWith("CLOSE"))
        throw Object.assign(new Error("aborted transaction"), { code: "25P02" });
      return [];
    });
    await expect(
      guarded.finish(async (tx) => {
        const cursor = await tx.cursor(sql`SELECT 1`);
        try {
          await cursor.read();
        } finally {
          await cursor.close();
        }
      }),
    ).rejects.toMatchObject({ code: "57014" });
    expect(unsafe.mock.calls.some(([text]) => text.startsWith("CLOSE"))).toBe(false);
  });

  it("still surfaces CLOSE errors on a successful read", async () => {
    const { unsafe, guarded } = driver();
    unsafe.mockImplementation(async (text) => {
      if (text.startsWith("CLOSE"))
        throw Object.assign(new Error("close failed"), { code: "34000" });
      return [];
    });
    await expect(
      guarded.finish(async (tx) => {
        await tx.cursor(sql`SELECT 1`);
      }),
    ).rejects.toMatchObject({ code: "34000" });
  });
});
