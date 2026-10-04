import { sql } from "drizzle-orm";
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
let single: Database;

beforeAll(async () => {
  owner = createOwner();
  [A] = await seedTwoClinics(owner);
  // One connection: the next transaction is guaranteed to reuse the connection the first one left.
  single = createDatabase({
    url: TEST_URLS.appUrl,
    role: "eyadex_app",
    ids: { newId: () => A.clinicId },
    maxConnections: 1,
  });
});

afterAll(async () => {
  await single.close();
  await owner.end();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * savepoint `fn` ماستناهوش وكان واقف: لو الـ connection رجعت للـ pool قبل ما يخلص، الـ driver كان
 * هيبعت `ROLLBACK TO SAVEPOINT` لما الـ callback يصحى — على transaction تانية شغّالة على نفس
 * الـ connection، وأسماء savepoints بتاعة Drizzle متوقّعة. (Codex على PR #22، P1.)
 */
describe("an abandoned savepoint is settled before its connection is reused", () => {
  it("ends a paused child at once and leaves the next transaction on that connection untouched", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resumed: Promise<string> | undefined;
    try {
      const first = single.withTenant(A.clinicId, async (tx) => {
        resumed = new Promise((resolve) => {
          void tx
            .transaction(async (savepoint) => {
              await gate; // paused until the next transaction already holds the connection
              await savepoint.execute(sql`SELECT 1`);
            })
            .then(
              () => resolve("ran"),
              (error: unknown) => resolve(String((error as Error).name)),
            );
        });
      });
      // Waiting for fn's paused callback instead of ending the savepoint would hang right here.
      const outcome = await Promise.race([
        first.then(
          () => "committed",
          (error: unknown) => error,
        ),
        pause(3000).then(() => "hung"),
      ]);
      expect((outcome as TenantContextViolationError).breach).toBe("unfinished-savepoint");

      const [inSavepoint, after] = [newTestId(), newTestId()];
      await single.withTenant(A.clinicId, async (tx) => {
        await tx.transaction((savepoint) => insertBranch(savepoint, A.clinicId, inSavepoint));
        release(); // the abandoned callback wakes up while this transaction holds the connection
        await pause(100);
        await insertBranch(tx, A.clinicId, after);
      });
      expect(await resumed).not.toBe("ran");
      const rows = await owner`SELECT id FROM branches WHERE id IN (${inSavepoint}, ${after})`;
      expect(rows).toHaveLength(2);
    } finally {
      release();
    }
  }, 20_000);
});
