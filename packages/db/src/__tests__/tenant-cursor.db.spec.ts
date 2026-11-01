import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Tx } from "../index.ts";
import { createOwner, seedTwoClinics, TEST_URLS, type ClinicFixture } from "./test-database.ts";

let owner: Sql;
let app: Database;
let A: ClinicFixture;
let B: ClinicFixture;
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

describe("tenant SELECT cursors", () => {
  it("binds parameters, reads bounded pages from one snapshot, and permits current checks between pages", async () => {
    await app.withTenant(A.clinicId, async (tx) => {
      const cursor = await tx.cursor<{ id: number; name: string }>(sql`SELECT n AS id,
        (SELECT name_ar FROM clinics WHERE id = ${A.clinicId}) AS name
        FROM generate_series(1, ${1_201}::int) n ORDER BY n`);
      try {
        const first = await cursor.read();
        expect(first).toHaveLength(500);
        const originalName = first[0]!.name;
        await owner`UPDATE clinics SET name_ar = 'اسم محدث' WHERE id = ${A.clinicId}`;
        expect(
          (
            await tx.execute<{ name: string }>(
              sql`SELECT name_ar AS name FROM clinics WHERE id = ${A.clinicId}`,
            )
          )[0]!.name,
        ).toBe("اسم محدث");
        const second = await cursor.read();
        expect(second).toHaveLength(500);
        expect(second[0]).toEqual({ id: 501, name: originalName });
        expect(await cursor.read()).toHaveLength(201);
        expect(await cursor.read()).toHaveLength(0);
      } finally {
        await cursor.close();
      }
    });
  });
  it("enforces forced RLS even when the query explicitly names another clinic", async () => {
    await app.withTenant(A.clinicId, async (tx) => {
      const cursor = await tx.cursor(sql`SELECT id FROM patients WHERE clinic_id = ${B.clinicId}`);
      expect(await cursor.read()).toEqual([]);
      await cursor.close();
    });
  });
  it("rejects writes, session changes and multiple statements before declaring a cursor", async () => {
    for (const query of [
      sql`DELETE FROM patients`,
      sql.raw("SELECT set_config('app.clinic_id', '', false)"),
      sql.raw("SELECT 1; COMMIT"),
    ]) {
      await expect(app.withTenant(A.clinicId, (tx) => tx.cursor(query))).rejects.toThrow();
    }
  });
  it("invalidates an escaped cursor and a kept factory after commit", async () => {
    let kept: Tx["cursor"] | undefined;
    const cursor = await app.withTenant(A.clinicId, async (tx) => {
      kept = tx.cursor;
      return tx.cursor(sql`SELECT 1`);
    });
    expect(() => cursor.read()).toThrow("no longer valid");
    await expect(kept!(sql`SELECT 1`)).rejects.toThrow("no longer valid");
  });
  it("refuses an unobserved cursor factory, rolling back its surrounding transaction", async () => {
    await expect(
      app.withTenant(A.clinicId, async (tx) => {
        void tx.cursor(sql`SELECT 1`);
      }),
    ).rejects.toThrow();
  });
});
