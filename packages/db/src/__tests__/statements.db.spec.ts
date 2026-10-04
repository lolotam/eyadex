import { sql, type SQL } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, ForbiddenStatementError, type Database, type Tx } from "../index.ts";
import {
  createOwner,
  idList,
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

const insertBranch = (tx: Tx, probe: string): Promise<unknown> =>
  tx.execute(sql`
    INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
    VALUES (${A.clinicId}, ${probe}, 'مسبار', 'Probe', true, now(), now())
  `);

const seenPatients = async (tx: Tx): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
  );
  return rows.map((row) => row.id);
};

/**
 * الجملة بتترفض **قبل** ما تتبعت، فعشان كده الـ assertion هنا مش بس إن الـ error طلع:
 *
 * 1. الكتابة اللي اتعملت قبل الجملة المرفوضة ماتت مع الـ rollback (لو `COMMIT` كانت اتنفذت،
 *    الكتابة كانت هتفضل محفوظة — فديها دليل على إن الجملة مرّت عادي).
 * 2. A لسه شايفة صفوفها بس: يعني العيادة ما اتحوّلتش لحد في أي لحظة.
 * 3. الرسالة مفيهاش الـ SQL ولا الـ parameters ولا أي id.
 */
const refuses = async (statement: SQL, keyword: string): Promise<ForbiddenStatementError> => {
  const probe = newTestId();
  let failure: unknown;
  try {
    await app.withTenant(A.clinicId, async (tx) => {
      await insertBranch(tx, probe);
      await tx.execute(statement);
      return "never reached";
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ForbiddenStatementError);
  const refusal = failure as ForbiddenStatementError;
  expect(refusal.keyword).toBe(keyword);
  expect(refusal).toBeInstanceOf(TypeError);
  // nothing committed — and if the statement had run, the branch above would have survived
  expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toHaveLength(0);
  // the clinic never moved
  expect(await app.withTenant(A.clinicId, seenPatients)).toEqual([A.patientId]);
  // the message names the keyword only
  for (const text of [refusal.message, String(refusal.stack), JSON.stringify(refusal)]) {
    for (const secret of [
      A.clinicId,
      B.clinicId,
      A.patientId,
      probe,
      "app.clinic_id",
      "SELECT",
      "'",
    ]) {
      expect(text).not.toContain(secret);
    }
  }
  return refusal;
};

describe("fn cannot end the transaction by hand", () => {
  it("refuses COMMIT", async () => {
    await refuses(sql`COMMIT`, "COMMIT");
  });

  it("refuses ROLLBACK, even with a leading line comment and a semicolon", async () => {
    await refuses(
      sql`-- c
rollback;`,
      "ROLLBACK",
    );
  });

  it("refuses ROLLBACK TO SAVEPOINT", async () => {
    await refuses(sql`ROLLBACK TO SAVEPOINT s1`, "ROLLBACK");
  });

  it("refuses END, which is the other spelling of COMMIT", async () => {
    await refuses(sql`END`, "END");
  });

  it("refuses a nested BEGIN, which would start a second transaction", async () => {
    await refuses(sql`BEGIN`, "BEGIN");
  });
});

describe("fn cannot loosen or rewrite the session", () => {
  it("refuses SET hidden behind a block comment", async () => {
    await refuses(sql`/* x */ SET statement_timeout = 0`, "SET");
  });

  it("refuses SET LOCAL", async () => {
    await refuses(sql`SET LOCAL statement_timeout = 0`, "SET");
  });

  it("refuses RESET hidden behind a line comment", async () => {
    await refuses(
      sql`-- c
RESET ALL`,
      "RESET",
    );
  });

  it("refuses DISCARD ALL — it would drop the session settings with them", async () => {
    await refuses(sql`DISCARD ALL`, "DISCARD");
  });

  it("refuses set_config in a SELECT, so the clinic cannot be re-pointed", async () => {
    await refuses(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`, "set_config");
  });

  it("refuses the set_config pair that re-points the clinic and puts it back", async () => {
    await refuses(
      sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true),
                 set_config('app.clinic_id', ${A.clinicId}, true)`,
      "set_config",
    );
  });

  it("refuses a session-level set_config, which would outlive the transaction", async () => {
    await refuses(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, false)`, "set_config");
  });

  it("refuses SET_CONFIG in upper case too", async () => {
    await refuses(sql`SELECT SET_CONFIG('statement_timeout', '0', true)`, "set_config");
  });

  it("refuses DO, which runs an anonymous block with its own privileges", async () => {
    await refuses(sql`DO $$ BEGIN PERFORM set_config('app.clinic_id', 'x', true); END $$`, "DO");
  });

  it("refuses a LOCK TABLE, which would block the whole cluster past the wrapper's return", async () => {
    await refuses(sql`LOCK TABLE clinics IN ACCESS EXCLUSIVE MODE`, "LOCK");
  });
});

describe("fn cannot prepare or copy around the driver", () => {
  it("refuses PREPARE — a named statement would outlive this transaction", async () => {
    await refuses(sql`PREPARE leak AS SELECT 1`, "PREPARE");
  });

  it("refuses CALL — a procedure runs outside the statement the wrapper checked", async () => {
    await refuses(sql`CALL some_procedure()`, "CALL");
  });

  it("refuses COPY, which streams rows straight off the connection", async () => {
    await refuses(sql`COPY clinics TO STDOUT`, "COPY");
  });

  it("refuses LOAD and LISTEN for the same reason", async () => {
    await refuses(sql`LOAD 'lib'`, "LOAD");
    await refuses(sql`LISTEN clinic_events`, "LISTEN");
  });
});

describe("the guard fails closed on a literal that merely contains the word", () => {
  it("refuses a harmless SELECT whose text carries set_config", async () => {
    // false positive مقصود: قيمة بين الأقواس فيها الكلمة دي رفضت، لأن الحارس fail-closed
    // (ADR-0002). زملة بتفضّل تكتب الاستعلام من غير نصوص ثابتة فيها الكلمة.
    await refuses(sql`SELECT 'set_config'::text AS note`, "set_config");
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
      await insertBranch(tx, probe);
      await tx.execute(sql`UPDATE branches SET name_en = 'Renamed' WHERE id = ${probe}`);
      return "updated";
    });
    const rows = await owner`SELECT name_en FROM branches WHERE id = ${probe}`;
    expect(rows[0]?.["name_en"]).toBe("Renamed");
  });

  it("a savepoint still works, because Drizzle opens it on its own session", async () => {
    const inside = await app.withTenant(A.clinicId, async (tx) => {
      await insertBranch(tx, newTestId());
      return await tx.transaction(async (savepoint) => {
        await savepoint.execute(sql`SELECT 1`);
        return "savepoint ran";
      });
    });
    expect(inside).toBe("savepoint ran");
  });
});
