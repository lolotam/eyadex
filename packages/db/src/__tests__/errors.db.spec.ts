import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, DatabaseError, type Database } from "../index.ts";
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

const caught = async (work: Promise<unknown>): Promise<DatabaseError> => {
  let failure: unknown;
  try {
    await work;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DatabaseError);
  return failure as DatabaseError;
};

describe("a database failure leaves the wrapper as DatabaseError", () => {
  it("a unique violation keeps the SQLSTATE and the constraint, and drops every row value", async () => {
    const probe = newTestId();
    const fullName = `مراجع-تسريب-${probe}`;
    const phone = `+9655${probe.replaceAll("-", "").slice(0, 6)}`;
    const failure = await caught(
      app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`
          INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
              registration_branch_id, civil_id, status, created_at, updated_at)
          VALUES (${A.clinicId}, ${probe}, '1', ${fullName}, ${phone}, '1991-02-03', 'male',
              ${A.branchId}, NULL, 'active', now(), now())
        `),
      ),
    );
    expect(failure.code).toBe("23505");
    expect(failure.constraint).toBe("patients_clinic_id_file_number_key");
    expect(failure.message).toBe(
      "database error 23505 (constraint patients_clinic_id_file_number_key)",
    );
    for (const text of [failure.message, JSON.stringify(failure), String(failure.stack)]) {
      expect(text).not.toContain(fullName);
      expect(text).not.toContain("Failing row");
      expect(text).not.toContain(phone);
    }
    // مفيش cause ولا SQL ولا parameters في أي صورة قابلة للقراءة
    // معرّفات بس: constraint و table و column — زي ما PostgreSQL قالهم.
    expect(Object.keys(failure).sort()).toEqual([
      "code",
      "column",
      "constraint",
      "name",
      "schema",
      "table",
    ]);
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
    expect((failure as { query?: unknown }).query).toBeUndefined();
    expect((failure as { params?: unknown }).params).toBeUndefined();
  });

  it("an RLS WITH CHECK violation is 42501 with no table data in the message", async () => {
    const probe = newTestId();
    const failure = await caught(
      app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`
          INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
          VALUES (${B.clinicId}, ${probe}, 'تسريب', 'Leak', true, now(), now())
        `),
      ),
    );
    expect(failure.code).toBe("42501");
    expect(failure.message).toBe("database error 42501");
    // An RLS refusal names no table — PostgreSQL reports the policy, not the relation.
    expect(failure.table).toBeUndefined();
    expect(failure.constraint).toBeUndefined();
  });

  it("a statement timeout is 57014", async () => {
    const impatient = createDatabase({
      url: TEST_URLS.appUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
      transactionTimeoutMs: 300,
    });
    try {
      const failure = await caught(
        impatient.withTenant(A.clinicId, (tx) => tx.execute(sql`SELECT pg_sleep(2)`)),
      );
      expect(failure.code).toBe("57014");
    } finally {
      await impatient.close();
    }
  });

  it("ping reports a broken connection as itself, not as a DatabaseError", async () => {
    const unreachable = createDatabase({
      url: "postgres://eyadex_app:unused@127.0.0.1:1/eyadex",
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
    });
    let failure: unknown;
    try {
      await unreachable.ping();
    } catch (error) {
      failure = error;
    }
    expect(failure).not.toBeInstanceOf(DatabaseError);
    expect(failure).toBeInstanceOf(Error);
    await unreachable.close();
  });
});

describe("an error from fn that is not a database error passes through untouched", () => {
  it("rethrows the very same object so a use case can translate it", async () => {
    const boom = new TypeError("the request had no clinic in it");
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, async () => {
        throw boom;
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBe(boom);
  });

  it("a ForbiddenStatementError is not wrapped either", async () => {
    let failure: { name?: string } | undefined;
    try {
      await app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`),
      );
    } catch (error) {
      failure = error as { name?: string };
    }
    expect(failure?.name).toBe("ForbiddenStatementError");
    expect(failure).not.toBeInstanceOf(DatabaseError);
  });
});

describe("only a real driver failure is converted", () => {
  it.each([
    ["a bare object with a SQLSTATE", { code: "23505" }],
    ["an Error carrying a SQLSTATE field", Object.assign(new Error("boom"), { code: "23505" })],
    [
      "an Error whose cause carries a SQLSTATE",
      new Error("wrapped by the caller", { cause: { code: "23505" } }),
    ],
  ])("rethrows %s from fn as the very same object", async (_label, thrown) => {
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, async () => {
        throw thrown;
      });
    } catch (error) {
      failure = error;
    }
    // نفس الـ object بالظبط: الـ wrapper شافه مش failure PostgreSQL، فمابعتّوش لـ DatabaseError
    expect(failure).toBe(thrown);
    expect(failure).not.toBeInstanceOf(DatabaseError);
  });
});
