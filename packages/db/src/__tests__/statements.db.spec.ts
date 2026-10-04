import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database, type Tx } from "../index.ts";
import { insertBranch, refuses, seenPatients } from "./refuse.ts";
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

/** الـ fixtures بتتحط في `beforeAll`، فالداتابيز بتتقرا وقت كل assertion مش وقت تحميل الملف. */
const fixture = () => ({ app, owner, A, B });

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

const addBranch = (tx: Tx, probe: string): Promise<unknown> => insertBranch(tx, A.clinicId, probe);
const seeMine = (tx: Tx): Promise<string[]> => seenPatients(tx, A, B);

describe("fn cannot end the transaction by hand", () => {
  it("refuses COMMIT", async () => {
    await refuses(fixture(), sql`COMMIT`, "COMMIT");
  });

  it("refuses ROLLBACK, even with a leading line comment and a semicolon", async () => {
    await refuses(
      fixture(),
      sql`-- c
rollback;`,
      "ROLLBACK",
    );
  });

  it("refuses ROLLBACK TO SAVEPOINT", async () => {
    await refuses(fixture(), sql`ROLLBACK TO SAVEPOINT s1`, "ROLLBACK");
  });

  it("refuses END, which is the other spelling of COMMIT", async () => {
    await refuses(fixture(), sql`END`, "END");
  });

  it("refuses a nested BEGIN, which would start a second transaction", async () => {
    await refuses(fixture(), sql`BEGIN`, "BEGIN");
  });
});

describe("fn cannot loosen or rewrite the session", () => {
  it("refuses SET hidden behind a block comment", async () => {
    await refuses(fixture(), sql`/* x */ SET statement_timeout = 0`, "SET");
  });

  it("refuses SET LOCAL", async () => {
    await refuses(fixture(), sql`SET LOCAL statement_timeout = 0`, "SET");
  });

  it("refuses RESET hidden behind a line comment", async () => {
    await refuses(
      fixture(),
      sql`-- c
RESET ALL`,
      "RESET",
    );
  });

  it("refuses DISCARD ALL — it would drop the session settings with them", async () => {
    await refuses(fixture(), sql`DISCARD ALL`, "DISCARD");
  });

  it("refuses set_config in a SELECT, so the clinic cannot be re-pointed", async () => {
    await refuses(
      fixture(),
      sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`,
      "set_config",
    );
  });

  it("refuses the set_config pair that re-points the clinic and puts it back", async () => {
    await refuses(
      fixture(),
      sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true),
                 set_config('app.clinic_id', ${A.clinicId}, true)`,
      "set_config",
    );
  });

  it("refuses a session-level set_config, which would outlive the transaction", async () => {
    await refuses(
      fixture(),
      sql`SELECT set_config('app.clinic_id', ${B.clinicId}, false)`,
      "set_config",
    );
  });

  it("refuses SET_CONFIG in upper case too", async () => {
    await refuses(fixture(), sql`SELECT SET_CONFIG('statement_timeout', '0', true)`, "set_config");
  });

  it("refuses a LOCK TABLE, which would block the whole cluster past the wrapper's return", async () => {
    await refuses(fixture(), sql`LOCK TABLE clinics IN ACCESS EXCLUSIVE MODE`, "LOCK");
  });

  it("refuses DO without naming the word its body hides", async () => {
    // The body of the red-team probe mentioned set_config, so the refusal names `set_config`
    // (the content check runs first, on the raw text). A DO block that does not mention it is
    // refused by its own kind.
    await refuses(fixture(), sql`DO $$ BEGIN PERFORM pg_sleep(0); END $$`, "DO");
  });
});

describe("fn cannot prepare or copy around the driver", () => {
  it("refuses PREPARE — a named statement would outlive this transaction", async () => {
    await refuses(fixture(), sql`PREPARE leak AS SELECT 1`, "PREPARE");
  });

  it("refuses CALL — a procedure runs outside the statement the wrapper checked", async () => {
    await refuses(fixture(), sql`CALL some_procedure()`, "CALL");
  });

  it("refuses COPY, which streams rows straight off the connection", async () => {
    await refuses(fixture(), sql`COPY clinics TO STDOUT`, "COPY");
  });

  it("refuses LOAD and LISTEN for the same reason", async () => {
    await refuses(fixture(), sql`LOAD 'lib'`, "LOAD");
    await refuses(fixture(), sql`LISTEN clinic_events`, "LISTEN");
  });
});

describe("the guard fails closed on a literal that merely contains the word", () => {
  it("refuses a harmless SELECT whose text carries set_config", async () => {
    // false positive مقصود: قيمة بين الأقواس فيها الكلمة دي رفضت، لأن الحارس fail-closed
    // (ADR-0002). زملة بتفضّل تكتب الاستعلام من غير نصوص ثابتة فيها الكلمة.
    await refuses(fixture(), sql`SELECT 'set_config'::text AS note`, "set_config");
  });
});

describe("ordinary statements still run", () => {
  it("a CTE goes through", async () => {
    const rows = await app.withTenant(A.clinicId, (tx) =>
      tx.execute<{ total: string }>(sql`
        WITH mine AS (SELECT id FROM patients)
        SELECT count(*)::text AS total FROM mine
      `),
    );
    expect(Number(rows[0]?.total ?? -1)).toBeGreaterThan(0);
  });

  it("an INSERT … RETURNING goes through and commits", async () => {
    const probe = newTestId();
    const returned = await app.withTenant(A.clinicId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
        VALUES (${A.clinicId}, ${probe}, 'رجوع', 'Returning', true, now(), now())
        RETURNING id
      `);
      return rows.map((row) => row.id);
    });
    expect(returned).toEqual([probe]);
    const rows = await owner`SELECT id FROM branches WHERE id = ${probe}`;
    expect(rows).toHaveLength(1);
  });

  it("an UPDATE … SET is not a SET statement", async () => {
    // الكلمة المانعة هي **أول** كلمة في الجملة، وSET جوه UPDATE مالهاش لازمة
    const probe = newTestId();
    await app.withTenant(A.clinicId, async (tx) => {
      await addBranch(tx, probe);
      await tx.execute(sql`UPDATE branches SET name_en = 'Renamed' WHERE id = ${probe}`);
      return "updated";
    });
    const rows = await owner`SELECT name_en FROM branches WHERE id = ${probe}`;
    expect(rows[0]?.["name_en"]).toBe("Renamed");
  });

  it("a savepoint still works, because Drizzle opens it on its own session", async () => {
    const inside = await app.withTenant(A.clinicId, async (tx) => {
      await addBranch(tx, newTestId());
      return await tx.transaction(async (savepoint) => {
        await savepoint.execute(sql`SELECT 1`);
        return "savepoint ran";
      });
    });
    expect(inside).toBe("savepoint ran");
  });
});
