import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, TenantContextViolationError, type Database } from "../index.ts";
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const failingWork = () => Promise.reject(new Error("savepoint work failed"));

/**
 * "اتشافت" يعني مسار الفشل اتمسك: `then(onFulfilled)` لوحده و`finally` مش بيمسكوه.
 * (Codex على PR #22، P1.)
 */
describe("only a consumer that handles the failure counts as having seen the work", () => {
  const refusedWithRest = async (run: (probe: string) => Parameters<Database["withTenant"]>[1]) => {
    const probe = newTestId();
    const failure = await app
      .withTenant(A.clinicId, run(probe))
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect((failure as TenantContextViolationError).breach).toBe("unfinished-savepoint");
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toEqual([]);
  };

  it("refuses tx.transaction(fails).then(onSuccess) that nobody catches", async () => {
    await refusedWithRest((probe) => async (tx) => {
      void tx.transaction(failingWork).then(() => "ok");
      await pause(50);
      await insertBranch(tx, A.clinicId, probe);
    });
  });

  it("refuses tx.transaction(fails).finally(cleanup) that nobody catches", async () => {
    await refusedWithRest((probe) => async (tx) => {
      void tx.transaction(failingWork).finally(() => undefined);
      await pause(50);
      await insertBranch(tx, A.clinicId, probe);
    });
  });

  it("commits the rest when fn handled the savepoint's failure down the chain", async () => {
    const probe = newTestId();
    const handled = await app.withTenant(A.clinicId, async (tx) => {
      const outcome = await tx
        .transaction(failingWork)
        .then(() => "ok")
        .finally(() => undefined)
        .catch(() => "handled");
      await insertBranch(tx, A.clinicId, probe);
      return outcome;
    });
    expect(handled).toBe("handled");
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toEqual([{ id: probe }]);
  });
});
