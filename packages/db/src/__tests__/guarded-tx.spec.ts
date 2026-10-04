import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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

/** جملة اتبعت للـ driver: النص المجمّد والـ parameters زي ما وصلوا `unsafe`. */
interface Sent {
  readonly text: string;
  readonly params: readonly unknown[];
  /** اسم الـ connection اللي بتاعتها الجملة دي (`this` جوّه `unsafe`). */
  readonly connection: string;
}

/**
 * Drizzle transaction وهمية فيها **dialect حقيقي** (عشان الرسم يبقى زي الإنتاج بالظبط)،
 * و`session.client` مسجّل. لو الـ proxy سمح بأي اسم من الأسماء المرفوضة، الـ client الخام بيرجع
 * تاني (نعمل `set_config('app.clinic_id', <عيادة تانية>, false)` ونقرا صفوفها من غير أي check).
 */
const fakeRaw = () => {
  const sent: Sent[] = [];
  const record = function (this: { label: string }, text: string, params: readonly unknown[]) {
    sent.push({ text, params, connection: this.label });
    return Promise.resolve([{ one: 1 }]);
  };
  const client = (label: string) => ({ unsafe: record, label });
  const inner = {
    dialect: new PgDialect(),
    session: { client: client("inner") },
    rollback: () => "rolled back",
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => await fn(inner),
  };
  const raw = {
    dialect: new PgDialect(),
    session: { client: client("outer") },
    rollback: () => "rolled back",
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => await fn(inner),
    $client: "the raw postgres.js client",
    _: { session: "dialect internals" },
    query: "relational queries",
  };
  return { raw: raw as unknown as RawTx, sent, inner };
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

  it("binds execute to the transaction's own handle, and rollback to the transaction", async () => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    await tx.execute(sql`SELECT 1`);
    // `this` inside unsafe is the transaction's own connection, not the pool.
    expect(sent[0]?.connection).toBe("outer");
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
    const { raw, inner, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    let innerTx: unknown;
    const result = await tx.transaction(async (savepoint) => {
      innerTx = savepoint;
      expect(Object.getOwnPropertyNames(savepoint).sort()).toEqual([...TX_MEMBERS].sort());
      await expect(savepoint.execute(sql`SELECT 1`)).resolves.toEqual([{ one: 1 }]);
      expect(() => (savepoint as unknown as Record<string, unknown>)["session"]).toThrow(TypeError);
      return "savepoint ran";
    });
    expect(result).toBe("savepoint ran");
    // The savepoint's own handle answered, and the savepoint handle dies with the callback.
    expect(sent.map((entry) => entry.connection)).toEqual(["inner"]);
    expect(() => (innerTx as unknown as Record<string, unknown>)["execute"]).toThrow(TypeError);
  });
});

describe("execute is the only door, and it is checked", () => {
  it("refuses a forbidden statement before the driver ever sees it", async () => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    await expect(tx.execute(sql.raw("COMMIT"))).rejects.toBeInstanceOf(ForbiddenStatementError);
    expect(sent).toHaveLength(0);
  });

  it("refuses it in a savepoint too — the inner tx runs the same guard", async () => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    await expect(
      tx.transaction(() => tx.execute(sql.raw("SET statement_timeout = 0"))),
    ).rejects.toBeInstanceOf(ForbiddenStatementError);
    expect(sent).toHaveLength(0);
  });

  it("sends the rendered text and its parameters, once", async () => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    const rows = await tx.execute<{ id: string }>(
      sql`INSERT INTO branches (clinic_id, id) VALUES (${"clinic"}, ${"branch"}) RETURNING id`,
    );
    expect(rows).toEqual([{ one: 1 }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe("INSERT INTO branches (clinic_id, id) VALUES ($1, $2) RETURNING id");
    expect(sent[0]?.params).toEqual(["clinic", "branch"]);
    // مقفول: مش أي حد يقدر يغيّر اللي اتفحص بعد رسمة
    expect(Object.isFrozen(sent[0]?.params)).toBe(true);
  });
});

describe("the query is rendered once, and the text that is checked is the text that is sent", () => {
  /**
   * الـ red-team shape: `SQLWrapper` متطبوع جوه query حقيقي، بيرجّع نص مختلف كل مرة
   * `getSQL()` ينادي. قبل كده كان في رسمتين: واحدة للفحص وواحدة للإرسال، فاتزنّقت التانية.
   */
  const swappingSql = (first: string, second: string) => {
    let renders = 0;
    const swapper = {
      getSQL: () => {
        renders += 1;
        return sql.raw(renders === 1 ? first : second);
      },
    };
    return { query: sql`${swapper} AS hidden`, renders: () => renders };
  };

  it("runs the first rendering, never the second", async () => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    const swap = swappingSql(
      "SELECT 1 AS rendered",
      "SELECT set_config('app.clinic_id', 'x', true)",
    );
    await expect(tx.execute(swap.query)).resolves.toEqual([{ one: 1 }]);
    expect(swap.renders()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("SELECT 1 AS rendered");
    expect(sent[0]?.text).not.toContain("set_config");
  });

  it("refuses the second rendering's shape when it is the one the caller sent", async () => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    const swap = swappingSql("COMMIT", "SELECT 1");
    await expect(tx.execute(swap.query)).rejects.toBeInstanceOf(ForbiddenStatementError);
    expect(sent).toHaveLength(0);
  });

  it("does not re-render through Drizzle's own execute either", async () => {
    // `session.query` هي الطريقة التانية اللي Drizzle بيستخدمها. هي ما بتترسمش تاني، بس
    // الفحص بيقرا من نفس الـ handle عشان مفيش نداء تاني يقدر يرسم.
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    await tx.execute(sql`SELECT 1`);
    const session = (raw as unknown as { session: { query?: unknown } }).session;
    expect(session.query).toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});

describe("execute takes a real Drizzle SQL and nothing else", () => {
  it.each([
    ["a string", "SELECT set_config('app.clinic_id', 'x', true)"],
    ["an object with toQuery", { toQuery: () => ({ sql: "SELECT 1", params: [] }) }],
    ["an object with getSQL", { getSQL: () => sql`SELECT set_config('app.clinic_id', 'x', true)` }],
    ["a bare SQLWrapper subclass shape", { getSQL: () => sql`COMMIT` }],
  ])("refuses %s with a TypeError before any rendering", async (_label, fake) => {
    const { raw, sent } = fakeRaw();
    const { tx } = guardTransaction(raw);
    await expect(tx.execute(fake as never)).rejects.toBeInstanceOf(TypeError);
    expect(sent).toHaveLength(0);
  });

  it("names the reason without quoting what it was handed", async () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw);
    const failure = await tx
      .execute("SELECT set_config('app.clinic_id', 'x', true)" as never)
      .then(() => undefined)
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as TypeError).message).toMatch(/real Drizzle SQL object/);
    expect((failure as TypeError).message).toContain("ADR-0002");
    expect((failure as TypeError).message).not.toContain("set_config");
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
