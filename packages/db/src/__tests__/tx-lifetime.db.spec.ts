import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database, type Tx } from "../index.ts";
import { createOwner, seedTwoClinics, TEST_URLS, type ClinicFixture } from "./test-database.ts";

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

/**
 * الدوال اللي `fn` بياخدها من `tx` بتخلص مع الـ transaction (أو الـ savepoint) نفسها: الـ
 * `revoke()` بتاع الـ Proxy كان بيقفل القراءة بس، ودالة اتاخدت قبلها كانت بتفضل شغّالة.
 * (Codex على PR #22، P1.)
 */
describe("a method kept from tx ends with its transaction", () => {
  it("refuses a kept execute, transaction and rollback after the wrapper returns", async () => {
    let kept: Pick<Tx, "execute" | "transaction" | "rollback"> | undefined;
    await app.withTenant(A.clinicId, async (tx) => {
      kept = { execute: tx.execute, transaction: tx.transaction, rollback: tx.rollback };
      await kept.execute(sql`SELECT 1`);
    });
    await expect(kept!.execute(sql`SELECT 1`)).rejects.toThrow(/no longer valid/);
    await expect(kept!.transaction(async () => 1)).rejects.toThrow(/no longer valid/);
    expect(() => kept!.rollback()).toThrow(/no longer valid/);
  });

  it("refuses a savepoint's kept execute once the savepoint is released, outer tx still live", async () => {
    const outcome = await app.withTenant(A.clinicId, async (tx) => {
      let inner: Tx["execute"] | undefined;
      await tx.transaction(async (savepoint) => {
        inner = savepoint.execute;
        await inner(sql`SELECT 1`);
      });
      const refused = await inner!(sql`SELECT 1`).then(
        () => "ran",
        (error: unknown) => String((error as Error).message),
      );
      const outer = await tx.execute<{ n: number }>(sql`SELECT 2 AS n`);
      return { refused, outer: outer[0]?.n };
    });
    expect(outcome.refused).toMatch(/no longer valid/);
    expect(outcome.outer).toBe(2);
  });
});
