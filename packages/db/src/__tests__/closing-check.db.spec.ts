import { sql, type SQL } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TenantContextViolationError } from "../index.ts";
import {
  closeSession,
  openSession,
  sessionExecutor,
  type SessionExpectation,
} from "../session-check.ts";
import {
  createOwner,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let client: Sql;
let unguarded: PostgresJsDatabase;
let A: ClinicFixture;
let B: ClinicFixture;
let expected: SessionExpectation;

beforeAll(async () => {
  owner = createOwner();
  [A, B] = await seedTwoClinics(owner);
  expected = { role: "eyadex_app", clinicId: A.clinicId, timeoutMs: 10_000 };
  // A raw client of our own, so the test can break the session the way `fn` never can: the guard
  // is bypassed on purpose here, because that is the whole point — this file pins the SECOND
  // layer, for the case where the first one did not get the chance to run.
  client = postgres(TEST_URLS.appUrl, { max: 1, onnotice: () => undefined });
  unguarded = drizzle(client);
});

afterAll(async () => {
  await client.end();
  await owner.end();
});

/**
 * بيفتح transaction زي الـ wrapper بالظبط، يعمل الخلل، وبعدين يطلب `closeSession`. لو الـ closing
 * check شغال زي ما المفروض، هو اللي بيرمي والـ COMMIT ما بيحصلش.
 *
 * @param sabotage الجملة اللي بتخرّب الجلسة — على الـ transaction الحقيقية، خارج الحارس
 * @returns الـ error اللي `closeSession` رماه
 */
const breach = async (sabotage: SQL): Promise<unknown> => {
  const failure = await unguarded.transaction(async (raw) => {
    const executor = sessionExecutor(raw);
    await openSession(executor, expected);
    await raw.execute(sabotage);
    return closeSession(executor, expected).then(
      () => undefined,
      (error: unknown) => error,
    );
  });
  return failure;
};

describe("the closing check is the second layer, not the only one", () => {
  it("catches a clinic re-pointed behind the guard's back", async () => {
    const failure = await breach(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("clinic");
  });

  it("catches a session-level clinic value that would have outlived the COMMIT", async () => {
    const failure = await breach(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, false)`);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("clinic");
  });

  it("catches a hand-rolled ROLLBACK, which drops the transaction-local value", async () => {
    const failure = await breach(sql`ROLLBACK`);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("clinic");
  });

  it("catches a hand-rolled COMMIT, which would persist half the work", async () => {
    const failure = await breach(sql`COMMIT`);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("clinic");
  });

  it("catches a removed statement_timeout", async () => {
    const failure = await breach(sql`SET statement_timeout = 0`);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("statement-timeout");
  });

  it("catches a removed idle_in_transaction_session_timeout", async () => {
    const failure = await breach(sql`SET idle_in_transaction_session_timeout = 0`);
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("idle-timeout");
  });

  it("names the breach and never the values it read", async () => {
    const failure = (await breach(
      sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`,
    )) as TenantContextViolationError;
    expect(failure.message).not.toContain(A.clinicId);
    expect(failure.message).not.toContain(B.clinicId);
    expect(Object.keys(failure).sort()).toEqual(["breach", "name"]);
  });

  it("commits normally when nothing changed, and clears the session clinic", async () => {
    const probe = newTestId();
    await unguarded.transaction(async (raw) => {
      const executor = sessionExecutor(raw);
      await openSession(executor, expected);
      await raw.execute(sql`
        INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
        VALUES (${A.clinicId}, ${probe}, 'سليم', 'Intact', true, now(), now())
      `);
      await closeSession(executor, expected);
    });
    expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toHaveLength(1);
    // نفس الـ connection اتسابت نضيفة: مفيش قيمة عيادة على مستوى الـ session بعد الـ COMMIT
    const leftover = await client<{ clinic: string | null }[]>`
      SELECT current_setting('app.clinic_id', true) AS clinic
    `;
    expect(leftover[0]?.clinic ?? "").toBe("");
  });
});
