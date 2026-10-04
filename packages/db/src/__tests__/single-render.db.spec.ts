import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.ts";
import { insertBranch, seenPatients } from "./refuse.ts";
import {
  createOwner,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let A: ClinicFixture;
let B: ClinicFixture;
let app: Database;

beforeAll(async () => {
  owner = createOwner();
  [A, B] = await seedTwoClinics(owner);
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

/**
 * `SQLWrapper` متطبوع جوه query حقيقي، بيرجّع **نص مختلف** كل مرة `getSQL()` ينادي. ده هو
 * الـ red-team shape بتاع الجولة الأخيرة: قبل الـ fix كان في رسمتين — واحدة للحارس وواحدة
 * للإرسال — فاتزنّقت التانية وعدّت `set_config` أو `COMMIT` من غير ما الحارس يشوف كلمة.
 *
 * `@returns` الـ query نفسها، وعداد المرات اللي اتقرا فيها.
 */
const swappingQuery = (first: string, second: string, prefix = "SELECT ") => {
  let renders = 0;
  const swapper = {
    getSQL: () => {
      renders += 1;
      return sql.raw(renders === 1 ? first : second);
    },
  };
  // `prefix` قبل القطعة: النص المرسوم لازم يبقى جملة صالحة، عشان الفرق يكون في **الترسيمة**
  // التانية مش في جملة مكسورة. و`""` يعني نبدأ من القطعة نفسها، فالتنمرة الأولى هي الجملة كلها.
  return { query: sql`${sql.raw(prefix)}${swapper} AS hidden`, renders: () => renders };
};

describe("the statement the guard checked is the statement that is sent", () => {
  it("renders once, so a second rendering never runs", async () => {
    const swap = swappingQuery("SELECT 1 AS rendered", "SELECT 1 AS rendered_again");
    const rows = await app.withTenant(A.clinicId, (tx) =>
      tx.execute<{ rendered: number }>(swap.query),
    );
    expect(rows.length).toBe(1);
    expect(swap.renders()).toBe(1);
  });

  it("never sends a smuggled COMMIT — and the write it would have committed survives", async () => {
    // With a second rendering the driver would have run `COMMIT` on the simple protocol (no
    // parameters), the transaction would have ended early, the closing check would have failed,
    // and — the point — the branch written just before would have been durable anyway.
    const probe = newTestId();
    const swap = swappingQuery("SELECT 1 AS rendered", "COMMIT");
    const result = await app.withTenant(A.clinicId, async (tx) => {
      await insertBranch(tx, A.clinicId, probe);
      await tx.execute(swap.query);
      return "committed normally";
    });
    expect(result).toBe("committed normally");
    expect(swap.renders()).toBe(1);
    // A normal COMMIT: the insert is there, which is what makes this different from a smuggled one.
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toHaveLength(1);
  });

  it("never sends a smuggled set_config, so the clinic cannot be re-pointed mid-transaction", async () => {
    // The red team read clinic B's patient this way and the wrapper still resolved, because the
    // transaction-local value was restored before the closing check ran.
    const swap = swappingQuery(
      "SELECT 1 AS rendered",
      `SELECT set_config('app.clinic_id', '${B.clinicId}', true)`,
    );
    const seen = await app.withTenant(A.clinicId, async (tx) => {
      await tx.execute(swap.query);
      return await seenPatients(tx, A, B);
    });
    expect(seen).toEqual([A.patientId]);
    expect(swap.renders()).toBe(1);
  });

  it("refuses the smuggled statement when the first rendering is the forbidden one", async () => {
    const swap = swappingQuery("SET statement_timeout = 0", "SELECT 1", "");
    await expect(app.withTenant(A.clinicId, (tx) => tx.execute(swap.query))).rejects.toThrowError(
      /not one fn may send/,
    );
    expect(swap.renders()).toBe(1);
  });
});

describe("execute takes a genuine Drizzle SQL, and nothing else", () => {
  it.each([
    ["a string", "SELECT set_config('app.clinic_id', 'other', true)"],
    ["an object with toQuery", { toQuery: () => ({ sql: "SELECT 1", params: [] }) }],
    ["an object with getSQL", { getSQL: () => sql`COMMIT` }],
  ])("refuses %s with a TypeError, before anything is rendered", async (_label, fake) => {
    const failure = await app
      .withTenant(A.clinicId, (tx) => tx.execute(fake as never))
      .then(() => undefined)
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as TypeError).message).toContain("real Drizzle SQL object");
  });

  it("rolls the transaction back when it is refused", async () => {
    const probe = newTestId();
    await app
      .withTenant(A.clinicId, async (tx) => {
        await insertBranch(tx, A.clinicId, probe);
        await tx.execute({ toQuery: () => ({ sql: "SELECT 1", params: [] }) } as never);
        return "never reached";
      })
      .catch(() => undefined);
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toHaveLength(0);
  });
});

describe("the result of execute is still the driver’s rows", () => {
  it("returns the rows of a parameterised query, as an array", async () => {
    const rows = await app.withTenant(A.clinicId, (tx) =>
      tx.execute<{ id: string; full_name: string }>(
        sql`SELECT id, full_name FROM patients WHERE clinic_id = ${A.clinicId} ORDER BY id`,
      ),
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([A.patientId]);
    // والصفوف بيانات خام: مفيش handle متشبّط بيرجّعنا للـ driver
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["full_name", "id"]);
  });
});
