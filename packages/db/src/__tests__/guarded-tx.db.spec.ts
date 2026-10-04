import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database, type Tx } from "../index.ts";
import { TX_MEMBERS } from "../guarded-tx.ts";
import {
  createOwner,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let A: ClinicFixture;
let app: Database;

beforeAll(async () => {
  owner = createOwner();
  [A] = await seedTwoClinics(owner);
  app = createDatabase({
    url: TEST_URLS.appUrl,
    role: "eyadex_app",
    ids: { newId: () => A.clinicId },
  });
});

afterAll(async () => {
  await app.close();
  await owner.end();
});

/** بيقرا حاجة من الـ tx ويرجّع الخطأ لو القراءة مرفوضة، عشان الـ assertion يبقى واضح. */
const read = (attempt: () => unknown): unknown => {
  try {
    attempt();
    return undefined;
  } catch (error) {
    return error;
  }
};

const insertBranch = (tx: Tx, probe: string): Promise<unknown> =>
  tx.execute(sql`
    INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
    VALUES (${A.clinicId}, ${probe}, 'فرع', 'Branch', true, now(), now())
  `);

/** أسماء لو الـ driver لسه متشبّث في أي قيمة `fn` ممكن تشوفها. */
const DRIVER_HANDLES = [
  "session",
  "client",
  "sql",
  "query",
  "unsafe",
  "dialect",
  "execute",
  "transaction",
  "handler",
  "socket",
  "conn",
  "connection",
  "$client",
];

describe("fn receives a guarded transaction, not the Drizzle object", () => {
  it("shows the allow-list and hides the driver members", async () => {
    const seen = await app.withTenant(A.clinicId, async (tx) => {
      const loose = tx as unknown as Record<string, unknown>;
      return {
        ownNames: Object.getOwnPropertyNames(tx).sort(),
        hasSession: "session" in tx,
        hasSessionDescriptor: Object.getOwnPropertyDescriptor(tx, "session") !== undefined,
        prototype: Object.getPrototypeOf(tx),
        sessionRead: read(() => loose["session"]),
        underscoreRead: read(() => loose["_"]),
        clientRead: read(() => loose["$client"]),
        dialectRead: read(() => loose["dialect"]),
      };
    });
    expect(seen.ownNames).toEqual([...TX_MEMBERS].sort());
    expect(seen.hasSession).toBe(false);
    expect(seen.hasSessionDescriptor).toBe(false);
    expect(seen.prototype).toBeNull();
    expect(seen.sessionRead).toBeInstanceOf(TypeError);
    expect(seen.underscoreRead).toBeInstanceOf(TypeError);
    expect(seen.clientRead).toBeInstanceOf(TypeError);
    expect(seen.dialectRead).toBeInstanceOf(TypeError);
  });

  it("the query builders are not reachable either — execute is the only door to SQL", async () => {
    const seen = await app.withTenant(A.clinicId, async (tx) => {
      const loose = tx as unknown as Record<string, unknown>;
      return {
        select: read(() => loose["select"]),
        insert: read(() => loose["insert"]),
        update: read(() => loose["update"]),
        delete: read(() => loose["delete"]),
        with: read(() => loose["with"]),
        count: read(() => loose["$count"]),
        distinct: read(() => loose["selectDistinct"]),
      };
    });
    for (const failure of Object.values(seen)) {
      expect(failure).toBeInstanceOf(TypeError);
    }
  });

  it("the result of execute is a row array with no driver handle hanging off it", async () => {
    // الباكاج مالوش schema (دي B3b)، فـ execute هو الباب الوحيد. لو الـ result نفسه كان فيه
    // حاجة ترجّعنا للـ client — `statement` أو `columns` أو `state` — يبقى الـ guard ناقص.
    const result = await app.withTenant(A.clinicId, (tx) =>
      tx.execute<{ id: string; name_ar: string }>(
        sql`SELECT id, name_ar FROM branches WHERE clinic_id = ${A.clinicId} LIMIT 3`,
      ),
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const ownNames = Object.getOwnPropertyNames(result);
    for (const handle of DRIVER_HANDLES) {
      expect(ownNames).not.toContain(handle);
    }
    // والصفوف نفسها كمان: كائنات بيانات خام، مفيش prototype متشبّط بيحمل connection
    for (const row of result) {
      expect(Object.getOwnPropertyNames(row).sort()).toEqual(["id", "name_ar"]);
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    }
    // والـ prototype بتاع الـ result كله: تعريفات class، مفيش handle
    const prototype = Object.getPrototypeOf(result) as object;
    expect(Object.getOwnPropertyNames(prototype)).toEqual(["constructor"]);
    for (const handle of DRIVER_HANDLES) {
      expect(Object.getOwnPropertyNames(prototype)).not.toContain(handle);
    }
  });

  it("a tx kept after the transaction ended throws on every use", async () => {
    let kept: Tx | undefined;
    await app.withTenant(A.clinicId, async (tx) => {
      kept = tx;
      return "committed";
    });
    const escaped = kept;
    expect(escaped).toBeDefined();
    expect(() => escaped?.execute(sql`SELECT 1`)).toThrow(TypeError);
    expect(() => escaped?.rollback).toThrow(TypeError);
    expect(() => Object.getOwnPropertyNames(escaped as object)).toThrow(TypeError);
  });

  it("refuses to hand the transaction back — `then` is not allow-listed either", async () => {
    // Returning the tx would leave a live handle on a committed connection. `await` reads `.then`
    // off the resolved value, and the guard refuses it, so the transaction rolls back.
    const failure = await app
      .withTenant(A.clinicId, (tx) => Promise.resolve(tx))
      .then(() => undefined)
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as TypeError).message).toMatch(/asked for then/);
  });

  it("a savepoint tx kept after the savepoint ended throws too", async () => {
    let kept: Tx | undefined;
    await app.withTenant(A.clinicId, (tx) =>
      tx.transaction(async (savepoint) => {
        kept = savepoint;
        return "savepoint committed";
      }),
    );
    expect(() => kept?.execute(sql`SELECT 1`)).toThrow(TypeError);
  });

  it("a savepoint works and hands the callback a guarded inner tx", async () => {
    const probe = newTestId();
    const inside = await app.withTenant(A.clinicId, async (tx) => {
      await insertBranch(tx, probe);
      return await tx.transaction(async (savepoint) => {
        const loose = savepoint as unknown as Record<string, unknown>;
        return {
          ownNames: Object.getOwnPropertyNames(savepoint).sort(),
          sessionRead: read(() => loose["session"]),
          selectRead: read(() => loose["select"]),
          total: await savepoint.execute<{ total: string }>(
            sql`SELECT count(*)::text AS total FROM branches WHERE clinic_id = ${A.clinicId}`,
          ),
        };
      });
    });
    expect(inside.ownNames).toEqual([...TX_MEMBERS].sort());
    expect(inside.sessionRead).toBeInstanceOf(TypeError);
    expect(inside.selectRead).toBeInstanceOf(TypeError);
    expect(Number(inside.total[0]?.total ?? -1)).toBeGreaterThan(1);
    const rows = await owner`SELECT id FROM branches WHERE id = ${probe}`;
    expect(rows).toHaveLength(1);
  });

  it("rollback() still stops the transaction the sanctioned way", async () => {
    const probe = newTestId();
    const failure = await app
      .withTenant(A.clinicId, async (tx) => {
        await insertBranch(tx, probe);
        tx.rollback();
        return "never reached";
      })
      .then(() => undefined)
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    const rows = await owner`SELECT id FROM branches WHERE id = ${probe}`;
    expect(rows).toHaveLength(0);
  });
});
