import { describe, expect, it } from "vitest";

import { guardTransaction, TX_MEMBERS, type RawTx } from "../guarded-tx.ts";

/** أي حاجة: الـ guard بيتعامل مع الـ members كأسماء، مش كقيم. */
const ANY_SQL = "any SQL fragment";

/**
 * Drizzle transaction وهمية فيها كل اللي الـ guard بيرفضه: الـ session والـ dialect والـ
 * `_` والـ `$client` بتوع postgres.js. لو الـ proxy سمح بأي واحد فيهم، الـ driver الخام بيرجع
 * تاني ونقدر نعمل `set_config('app.clinic_id', <عيادة تانية>, false)` من غير أي check.
 */
const fakeRaw = () => {
  const boundTo: unknown[] = [];
  const driver = { unsafe: "the raw postgres.js client" };
  const inner = { session: "inner session", execute: () => "inner ran" };
  const raw = {
    execute(this: unknown) {
      boundTo.push(this);
      return "outer ran";
    },
    rollback: () => "rolled back",
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => await fn(inner),
    session: { client: driver },
    _: { session: "dialect internals" },
    dialect: "postgresql",
    $client: driver,
    query: "relational queries",
  };
  return { raw: raw as unknown as RawTx, boundTo, inner };
};

describe("the guarded Tx surface", () => {
  it("shows exactly the allow-list and nothing else", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    expect(Object.getOwnPropertyNames(tx).sort()).toEqual([...TX_MEMBERS].sort());
  });

  it("does not answer `in` for the driver members but does for the allow-list", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    for (const hidden of ["session", "_", "dialect", "$client", "query", "constructor"]) {
      expect(hidden in tx).toBe(false);
      expect(Object.getOwnPropertyDescriptor(tx, hidden)).toBeUndefined();
    }
    expect("execute" in tx).toBe(true);
    expect(Object.getPrototypeOf(tx)).toBeNull();
  });

  it.each(["session", "_", "$client", "dialect", "query", "constructor", "toString"])(
    "throws a TypeError when %j is read",
    (member) => {
      const { raw } = fakeRaw();
      const { tx } = guardTransaction(raw);
      expect(() => (tx as unknown as Record<string, unknown>)[member]).toThrow(TypeError);
    },
  );

  it("throws when a symbol is read too — no reflection escape hatch", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    expect(() => Reflect.get(tx, Symbol.toStringTag)).toThrow(TypeError);
  });

  it("does not type-check tx.session either — Tx is the allow-list and nothing more", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    // @ts-expect-error the driver members are absent from Tx, so this line cannot compile.
    const reach = (): unknown => tx.session;
    expect(reach).toThrow(TypeError);
  });

  it("binds the allow-listed methods to the real transaction", () => {
    const { raw, boundTo } = fakeRaw();
    const { tx } = guardTransaction(raw);
    expect(tx.execute(ANY_SQL)).toBe("outer ran");
    expect(boundTo[0]).toBe(raw);
  });

  it("refuses to be written to, redefined or emptied", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    const loose = tx as unknown as Record<string, unknown>;
    expect(() => {
      loose["execute"] = "hijacked";
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(tx, "select", { value: "hijacked" });
    }).toThrow(TypeError);
    expect(() => {
      delete loose["execute"];
    }).toThrow(TypeError);
  });

  it("keeps a savepoint callback inside the same guard and revokes it afterwards", async () => {
    const { raw, inner } = fakeRaw();
    const { tx } = guardTransaction(raw);
    let innerTx: unknown;
    const result = await tx.transaction(async (savepoint) => {
      innerTx = savepoint;
      expect(Object.getOwnPropertyNames(savepoint).sort()).toEqual([...TX_MEMBERS].sort());
      // The real inner transaction answers, through the guard: only `inner` says "inner ran".
      expect(savepoint.execute(ANY_SQL)).toBe("inner ran");
      expect(() => (savepoint as unknown as Record<string, unknown>)["session"]).toThrow(TypeError);
      return "savepoint ran";
    });
    expect(result).toBe("savepoint ran");
    expect(inner.execute()).toBe("inner ran");
    // The savepoint handle is revoked the moment its callback returns.
    expect(() => (innerTx as unknown as Record<string, unknown>)["execute"]).toThrow(TypeError);
  });
});

describe("a guarded tx dies with its transaction", () => {
  it("throws on any use after revoke, which the wrappers call after COMMIT or ROLLBACK", () => {
    const { raw } = fakeRaw();
    const { tx, revoke } = guardTransaction(raw);
    expect(tx.execute(ANY_SQL)).toBe("outer ran");
    revoke();
    expect(() => tx.execute(ANY_SQL)).toThrow(TypeError);
    expect(() => tx.rollback).toThrow(TypeError);
    expect(() => Object.getOwnPropertyNames(tx)).toThrow(TypeError);
  });

  it("revoking twice is harmless", () => {
    const { raw } = fakeRaw();
    const { revoke } = guardTransaction(raw);
    revoke();
    expect(() => {
      revoke();
    }).not.toThrow();
  });
});
