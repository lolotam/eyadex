import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, TenantContextViolationError, type Database, type Tx } from "../index.ts";
import { insertBranch } from "./refuse.ts";
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

/**
 * `tx.transaction(...)` من غير `await`: postgres.js بيستنى الـ savepoint بس عن طريق الـ promise
 * اللي رجعت للـ caller، فالـ callback كان ممكن يكمّل بعد الـ closing check أو بعد الـ COMMIT.
 * (Codex على PR #22، P1.)
 */
describe("a savepoint fn did not await cannot outlive the wrapper", () => {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("refuses the commit, and the savepoint's late SQL fails instead of running", async () => {
    const probe = newTestId();
    let late: Promise<string> | undefined;
    const failure = await app
      .withTenant(A.clinicId, async (tx) => {
        late = tx
          .transaction(async (savepoint) => {
            await pause(150);
            await insertBranch(savepoint, A.clinicId, probe);
            return "ran";
          })
          .catch((error: unknown) => String((error as Error).name));
      })
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("unfinished-savepoint");
    expect(await late).not.toBe("ran");
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toEqual([]);
  });

  it("refuses a savepoint that returned while its own child was still running", async () => {
    const failure = await app
      .withTenant(A.clinicId, (tx) =>
        tx.transaction(async (savepoint) => {
          void savepoint.transaction(async () => {
            await pause(100);
          });
        }),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect((failure as TenantContextViolationError).breach).toBe("unfinished-savepoint");
  });

  it("still commits a savepoint that fn awaited", async () => {
    const probe = newTestId();
    await app.withTenant(A.clinicId, (tx) =>
      tx.transaction((savepoint) => insertBranch(savepoint, A.clinicId, probe)),
    );
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toEqual([{ id: probe }]);
  });
});

/**
 * `tx.execute` من غير `await`، ودالة محفوظة في timer: الاتنين كانوا بيعدّوا بعد ما `fn` يرجع —
 * الأولى من غير ما حد يشوف نتيجتها (ورفضها كان unhandled)، والتانية ممكن تكتب بين الـ closing
 * check والـ COMMIT. (Codex على PR #22، P1 ×2.)
 */
describe("work fn did not await is refused, and nothing slips in after fn returns", () => {
  it("refuses an un-awaited execute — even a failing one leaves no unhandled rejection", async () => {
    const probe = newTestId();
    const failure = await app
      .withTenant(A.clinicId, async (tx) => {
        void insertBranch(tx, A.clinicId, probe);
        // a second, failing statement nobody awaits: duplicate primary key
        void insertBranch(tx, A.clinicId, A.branchId);
      })
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("unfinished-statement");
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toEqual([]);
  });

  it("closes tx the moment fn returns: a kept execute fired from a timer cannot write", async () => {
    const probe = newTestId();
    let fired: Promise<string> | undefined;
    await app.withTenant(A.clinicId, async (tx) => {
      const keptExecute = tx.execute;
      fired = new Promise((resolve) => {
        setTimeout(() => {
          keptExecute(
            sql`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
                VALUES (${A.clinicId}, ${probe}, 'ت', 'T', true, now(), now())`,
          ).then(
            () => resolve("wrote"),
            (error: unknown) => resolve(String((error as Error).message)),
          );
        }, 0);
      });
    });
    expect(await fired).toMatch(/no longer valid/);
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toEqual([]);
  });
});
