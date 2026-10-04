import { describe, expect, it } from "vitest";

import { guardTransaction, TX_MEMBERS, type RawTx } from "../guarded-tx.ts";
import { ForbiddenStatementError } from "../statement-guard.ts";

/** أي حاجة: الـ guard بيتعامل مع الـ members كأسماء، مش كقيم. */
const ANY_SQL = "any SQL fragment";

/** الأسماء اللي المفروض تترفض: البانيهات اللي بيرجعوا builder فيه `.session.client`، والـ driver. */
const REFUSED_MEMBERS = [
  // query builders — each returns a real Drizzle builder whose .session.client is the raw driver
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "insert",
  "update",
  "delete",
  "with",
  "$with",
  "$count",
  // the driver itself
  "session",
  "_",
  "dialect",
  "$client",
  "query",
  "constructor",
  "toString",
] as const;

/**
 * Drizzle transaction وهمية فيها كل اللي الـ guard بيرفضه. لو الـ proxy سمح بأي واحد فيهم،
 * either الـ driver الخام بيرجع تاني (نعمل `set_config('app.clinic_id', <عيادة تانية>, false)`
 * ونقرا صفوفها من غير أي check)، أو builder حقيقي بيرجع وبنقرا `builder.session.client` من بعد
 * أول `execute` — وده بالظبط السبب اللي الباكاج ده مالوش بانيهات لحد B3b.
 */
const fakeRaw = (statement = "SELECT 1") => {
  const boundTo: unknown[] = [];
  const sent: unknown[] = [];
  const driver = { unsafe: "the raw postgres.js client" };
  const inner = {
    execute: () => "inner ran",
    dialect: { sqlToQuery: () => ({ sql: statement }) },
  };
  const raw = {
    execute(this: unknown, query: unknown) {
      boundTo.push(this);
      sent.push(query);
      return "outer ran";
    },
    rollback: () => "rolled back",
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => await fn(inner),
    // the dialect is internal: the guard reads it, `fn` never does
    dialect: { sqlToQuery: () => ({ sql: statement }) },
    session: { client: driver },
    _: { session: "dialect internals" },
    $client: driver,
    query: "relational queries",
  };
  return { raw: raw as unknown as RawTx, boundTo, sent, inner };
};

describe("the guarded Tx surface", () => {
  it("is exactly execute, transaction and rollback — the three names, written out", () => {
    // مثبّت بالحرف مش بس "يساوي TX_MEMBERS": لو حد رجّع builder في الـ allow-list، الاختبار ده
    // يقع حتى لو الـ array اتغير في نفس-PR معاه.
    expect([...TX_MEMBERS].sort()).toEqual(["execute", "rollback", "transaction"]);
  });

  it("shows exactly the allow-list and nothing else", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    expect(Object.getOwnPropertyNames(tx).sort()).toEqual([...TX_MEMBERS].sort());
  });

  it("does not answer `in` for the driver members but does for the allow-list", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    for (const hidden of REFUSED_MEMBERS) {
      expect(hidden in tx).toBe(false);
      expect(Object.getOwnPropertyDescriptor(tx, hidden)).toBeUndefined();
    }
    expect("execute" in tx).toBe(true);
    expect(Object.getPrototypeOf(tx)).toBeNull();
  });

  it.each([...REFUSED_MEMBERS, "then"])("throws a TypeError when %j is read", (member) => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    expect(() => (tx as unknown as Record<string, unknown>)[member]).toThrow(TypeError);
  });

  it("throws when a symbol is read too — no reflection escape hatch", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    expect(() => Reflect.get(tx, Symbol.toStringTag)).toThrow(TypeError);
  });

  it("does not type-check tx.session or tx.select either — Tx is the allow-list", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    // @ts-expect-error the driver members are absent from Tx, so this line cannot compile.
    const reach = (): unknown => tx.session;
    expect(reach).toThrow(TypeError);
    // @ts-expect-error the query builders are absent from Tx too.
    const build = (): unknown => tx.select();
    expect(build).toThrow(TypeError);
  });

  it("binds execute and rollback to the real transaction", async () => {
    const { raw, boundTo } = fakeRaw();
    const { tx } = guardTransaction(raw);
    await expect(tx.execute(ANY_SQL as never)).resolves.toBe("outer ran");
    expect(boundTo[0]).toBe(raw);
    expect(tx.rollback()).toBe("rolled back");
  });

  it("refuses to be written to, redefined or emptied", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    const loose = tx as unknown as Record<string, unknown>;
    expect(() => {
      loose["execute"] = "hijacked";
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(tx, "rollback", { value: "hijacked" });
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
      await expect(savepoint.execute(ANY_SQL as never)).resolves.toBe("inner ran");
      expect(() => (savepoint as unknown as Record<string, unknown>)["session"]).toThrow(TypeError);
      return "savepoint ran";
    });
    expect(result).toBe("savepoint ran");
    // The savepoint handle is revoked the moment its callback returns.
    expect(() => (innerTx as unknown as Record<string, unknown>)["execute"]).toThrow(TypeError);
  });
});

describe("execute is the only door, and it is checked", () => {
  it("refuses a forbidden statement before the transaction ever sees it", async () => {
    const { raw, boundTo, sent } = fakeRaw("COMMIT");
    const { tx } = guardTransaction(raw);
    await expect(tx.execute(ANY_SQL as never)).rejects.toBeInstanceOf(ForbiddenStatementError);
    expect(boundTo).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses it in a savepoint too — the inner tx runs the same guard", async () => {
    const { raw } = fakeRaw("SET statement_timeout = 0");
    const { tx } = guardTransaction(raw);
    await expect(tx.transaction(() => tx.execute(ANY_SQL as never))).rejects.toBeInstanceOf(
      ForbiddenStatementError,
    );
  });

  it("sends an allowed statement through, unchanged", async () => {
    const { raw, sent } = fakeRaw("INSERT INTO branches (id) VALUES ($1) RETURNING id");
    const { tx } = guardTransaction(raw);
    await expect(tx.execute(ANY_SQL as never)).resolves.toBe("outer ran");
    expect(sent).toEqual([ANY_SQL]);
  });
});

describe("a guarded tx dies with its transaction", () => {
  it("throws on any use after revoke, which the wrappers call after COMMIT or ROLLBACK", () => {
    const { raw } = fakeRaw();
    const { tx, revoke } = guardTransaction(raw);
    revoke();
    expect(() => tx.execute).toThrow(TypeError);
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
