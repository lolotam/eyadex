import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, DatabaseError, type Database } from "../index.ts";
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

/**
 * الجولات التلاتة دي بتكمّل شغل `statements.db.spec.ts`: نفس الـ assertions، بس على الأشكال
 * اللي الـ red-team أثبت إنها بتعدّي. كل حالة هنا كانت **بتعدّي فعلاً** على PostgreSQL 18 من
 * غير الـ fix — والـ `refuses` بيثبت إن الجملة ماترسلتش (ولا الكتابة قبلها اتحفظت، ولا العيادة
 * اتحوّلت) وإن الرسالة مفيهاش أي نص من اللي اتقرا.
 */
describe("a -- comment ends at a carriage return, and the checks read the raw text", () => {
  it("refuses the CR-smuggled set_config that re-pointed the clinic", async () => {
    // The red-team form: `--\r` swallowed the whole statement for a `\n`-only comment scanner, so
    // the guard read an empty body, found no first word, and ran the set_config test on nothing.
    await refuses(
      fixture(),
      sql.raw(`--\rselect set_config('app.clinic_id', '${B.clinicId}', true)`),
      "set_config",
    );
  });

  it("refuses the CR-smuggled COMMIT that persisted half a write", async () => {
    await refuses(fixture(), sql.raw("--\rCOMMIT"), "COMMIT");
    await refuses(fixture(), sql.raw("-- note\rCOMMIT AND SELECT 1"), "COMMIT");
  });

  it("refuses a CR-smuggled SET and a second statement after it", async () => {
    await refuses(fixture(), sql.raw("--\rSET statement_timeout = 0"), "SET");
    await refuses(fixture(), sql.raw("-- c\rSELECT 1; COMMIT"), "multiple statements");
  });
});

describe("Unicode-escaped identifiers are refused whole", () => {
  // `U&"set\005fconfig"` is `set_config` without its letters: the name check never sees them, and
  // PostgreSQL runs it happily. The red team re-pointed the clinic with it and read B's patient.
  it('refuses U&"…" in a function call', async () => {
    await refuses(
      fixture(),
      sql.raw(`select pg_catalog.U&"set\\005fconfig"('app.clinic_id', '${B.clinicId}', true)`),
      "U&",
    );
  });

  it("refuses U&'…' and the lower-case spelling", async () => {
    await refuses(fixture(), sql.raw(`SELECT U&'\\0063ommit'`), "U&");
    await refuses(fixture(), sql.raw(`select u&"x" from branches`), "U&");
  });

  it("still refuses a plainly quoted name, which shows its own letters", async () => {
    await refuses(
      fixture(),
      sql.raw(`select pg_catalog."SET_CONFIG"('app.clinic_id', '${B.clinicId}', true)`),
      "set_config",
    );
  });
});

describe("functions that run SQL given as text are refused", () => {
  it("refuses query_to_xml, where the name is built from two string literals", async () => {
    const smuggled =
      `select query_to_xml('select set_' || 'config(''app.clinic_id'', ' || ` +
      `quote_literal('${B.clinicId}') || ', true)', true, false, '')`;
    expect(smuggled).not.toContain("set_config");
    await refuses(fixture(), sql.raw(smuggled), "query_to_xml");
  });

  it("refuses ts_stat, which changed statement_timeout the same way", async () => {
    const smuggled = `select ts_stat('select set_' || 'config(''statement_timeout'', ''0'', true)')`;
    expect(smuggled).not.toContain("set_config");
    await refuses(fixture(), sql.raw(smuggled), "ts_stat");
  });

  it("refuses cursor_to_xml, which can execute a prepared statement's code", async () => {
    await refuses(
      fixture(),
      sql.raw(`select cursor_to_xml('commit', false, true, false)`),
      "cursor_to_xml",
    );
  });
});

describe("every statement kind outside the allow-list is refused by name", () => {
  it("refuses ALTER ROLE … SET, which used to persist a timeout on the role", async () => {
    await refuses(fixture(), sql.raw("ALTER ROLE eyadex_app SET statement_timeout = 0"), "ALTER");
    // The red-team version ran and stuck: every future session of the role lost its bound. The
    // role's defaults must be exactly as the migration left them.
    const role = await owner<{ rolconfig: string[] | null }[]>`
      SELECT rolconfig FROM pg_roles WHERE rolname = current_user
    `;
    expect(role[0]?.rolconfig ?? []).not.toContain("statement_timeout=0");
  });

  it("refuses CREATE FUNCTION in pg_temp — PUBLIC still has TEMP on the database", async () => {
    // It was refused by accident (the `;` inside the plpgsql body). It is refused by its kind now.
    await refuses(
      fixture(),
      sql.raw(
        "CREATE FUNCTION pg_temp.f() RETURNS void AS $$ BEGIN RETURN; END $$ LANGUAGE plpgsql",
      ),
      "CREATE",
    );
  });

  it("refuses EXECUTE, which would run postgres.js's own prepared statements", async () => {
    await refuses(fixture(), sql.raw("EXECUTE commit"), "EXECUTE");
    await refuses(fixture(), sql.raw("DEALLOCATE ALL"), "DEALLOCATE");
  });

  it("refuses the session and object statements the deny-list never mentioned", async () => {
    await refuses(fixture(), sql.raw("GRANT SELECT ON patients TO eyadex_platform"), "GRANT");
    await refuses(fixture(), sql.raw("TRUNCATE branches"), "TRUNCATE");
    await refuses(fixture(), sql.raw("VACUUM patients"), "VACUUM");
    await refuses(fixture(), sql.raw("CHECKPOINT"), "CHECKPOINT");
    await refuses(fixture(), sql.raw("DECLARE c CURSOR FOR SELECT 1"), "DECLARE");
    await refuses(fixture(), sql.raw("NOTIFY clinic_events"), "NOTIFY");
    await refuses(fixture(), sql.raw("DROP TABLE branches"), "DROP");
  });

  it("refuses a statement with nothing to check, and one with an open comment", async () => {
    await refuses(fixture(), sql.raw("-- nothing but a comment"), "empty statement");
    await refuses(fixture(), sql.raw("   "), "empty statement");
    await refuses(fixture(), sql.raw("SELECT 1 /* never closed"), "unterminated comment");
  });
});

describe("the allow-list is wide enough for the work fn has to do", () => {
  it("reads with TABLE, VALUES and a CTE", async () => {
    const seen = await app.withTenant(A.clinicId, async (tx) => {
      const table = await tx.execute<{ id: string }>(sql`TABLE patients`);
      const values = await tx.execute<{ n: number }>(sql`VALUES (1), (2)`);
      const cte = await tx.execute<{ total: string }>(sql`
        WITH mine AS (SELECT id FROM patients) SELECT count(*)::text AS total FROM mine
      `);
      return { table: table.map((row) => row.id), values: values.length, total: cte[0]?.total };
    });
    expect(seen.table).toEqual([A.patientId]);
    expect(seen.values).toBe(2);
    expect(Number(seen.total ?? -1)).toBeGreaterThan(0);
  });

  it("writes with MERGE — an allowed kind that really runs", async () => {
    const probe = newTestId();
    await app.withTenant(A.clinicId, async (tx) => {
      await insertBranch(tx, A.clinicId, probe);
      await tx.execute(sql`
        MERGE INTO branches b
        USING (SELECT ${probe}::uuid AS id) s ON b.id = s.id
        WHEN MATCHED THEN UPDATE SET name_en = 'Merged'
      `);
    });
    expect(await owner`SELECT name_en FROM branches WHERE id = ${probe}`).toEqual([
      { name_en: "Merged" },
    ]);
  });

  it("lets a DELETE through the guard — PostgreSQL is what refuses it, for the role", async () => {
    // `eyadex_app` has no DELETE grant on branches (db/sql/0013: read/write, never delete), so the
    // 42501 proves the statement reached the database: the guard allowed the kind, the grants said no.
    const failure = await app
      .withTenant(A.clinicId, (tx) =>
        tx.execute(sql`DELETE FROM branches WHERE id = ${A.branchId}`),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DatabaseError);
    expect((failure as DatabaseError).code).toBe("42501");
  });

  it("still sees only its own clinic after all of that", async () => {
    expect(await app.withTenant(A.clinicId, (tx) => seenPatients(tx, A, B))).toEqual([A.patientId]);
  });
});
