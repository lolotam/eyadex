import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, ForbiddenStatementError, type Database, type Tx } from "../index.ts";
import {
  createOwner,
  idList,
  newTestId,
  roleOf,
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
    maxConnections: 2,
  });
});

afterAll(async () => {
  await app.close();
  await owner.end();
});

const insertBranch = (tx: Tx, clinicId: string, probe: string): Promise<unknown> =>
  tx.execute(sql`
    INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
    VALUES (${clinicId}, ${probe}, 'اسم', 'Branch', true, now(), now())
  `);

const ownPatients = async (tx: Tx): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
  );
  return rows.map((row) => row.id);
};

/**
 * الجملة اللي كانت هتكسر السياق بتترفض قبل ما تتبعت، والكتابة اللي قبلها ما بتتعملش. الاختبار
 * بيحط الكتابة **قبل** الجملة المرفوضة عشان يثبت إن الـ COMMIT ما حصلش: لو `COMMIT` مرّت
 * عادي، الكتابة دي كانت هتفضل محفوظة في الداتابيز.
 */
const refusesAndKeepsNothing = async (statement: Parameters<Tx["execute"]>[0], keyword: string) => {
  const probe = newTestId();
  let failure: unknown;
  try {
    await app.withTenant(A.clinicId, async (tx) => {
      await insertBranch(tx, A.clinicId, probe);
      await tx.execute(statement);
      return "never reached";
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ForbiddenStatementError);
  expect((failure as ForbiddenStatementError).keyword).toBe(keyword);
  expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toHaveLength(0);
  // والعيادة ما اتحوّلتش: A لسه شايفة صفها بس
  expect(await app.withTenant(A.clinicId, ownPatients)).toEqual([A.patientId]);
  return failure as ForbiddenStatementError;
};

describe("fn cannot re-point the clinic", () => {
  it("is refused before the statement runs, and nothing is written under the other clinic", async () => {
    // set_config هي الدالة الوحيدة اللي تقدر تحوّل العيادة من جوه SELECT عادي، فالحارس بيرفضها
    // بالاسم في أي جملة. الفحص التاني (اللي بيقرا `app.clinic_id` قبل الـ COMMIT) متغطّى في
    // `closing-check.db.spec.ts` بالسيناريو اللي الحارس مش موجود فيه.
    const failure = await refusesAndKeepsNothing(
      sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`,
      "set_config",
    );
    expect(failure.message).not.toContain(A.clinicId);
    expect(failure.message).not.toContain(B.clinicId);
  });

  it("withNoTenant loses an injected clinic too — '' is not any clinic's id", async () => {
    let failure: unknown;
    try {
      await app.withNoTenant((tx) =>
        tx.execute(sql`SELECT set_config('app.clinic_id', ${A.clinicId}, true)`),
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ForbiddenStatementError);
  });

  it("the pool is still usable after a refused re-point", async () => {
    expect(await app.withTenant(A.clinicId, ownPatients)).toEqual([A.patientId]);
  });
});

describe("fn cannot end the transaction by hand", () => {
  it("a COMMIT inside fn is refused before it runs", async () => {
    await refusesAndKeepsNothing(sql`COMMIT`, "COMMIT");
  });

  it("a ROLLBACK inside fn is refused too", async () => {
    await refusesAndKeepsNothing(sql`ROLLBACK`, "ROLLBACK");
  });
});

describe("fn cannot loosen the time bound", () => {
  it("SET statement_timeout = 0 inside fn is refused before it runs", async () => {
    await refusesAndKeepsNothing(sql`SET statement_timeout = 0`, "SET");
  });

  it("SET idle_in_transaction_session_timeout = 0 inside fn is refused too", async () => {
    await refusesAndKeepsNothing(sql`SET idle_in_transaction_session_timeout = 0`, "SET");
  });
});

describe("fn cannot reach a more powerful role", () => {
  it("SET ROLE to the owner never leaves the wrapper — the guard refuses the whole statement", async () => {
    // قبل الحارس كان الرفض من السيرفر (`42501` — محتاج عضوية)، وده صح بس كان بيعتمد على
    // إن الدور التشغيلي مالوش عضوية. دلوقتي الرفض بيحصل عندنا قبل الإرسال، والحماية التانية
    // (فحص الـ memberships في أول statement) لسه موجودة.
    await refusesAndKeepsNothing(
      sql`SET ROLE ${sql.identifier(roleOf(TEST_URLS.ownerUrl))}`,
      "SET",
    );
  });

  it("SET SESSION AUTHORIZATION is refused as well — it needs superuser", async () => {
    await refusesAndKeepsNothing(
      sql`SET SESSION AUTHORIZATION ${sql.identifier(roleOf(TEST_URLS.ownerUrl))}`,
      "SET",
    );
  });

  it("even setting the role back to itself is refused — the guard is not a keyword allow-list", async () => {
    await refusesAndKeepsNothing(sql`SET ROLE ${sql.identifier(roleOf(TEST_URLS.appUrl))}`, "SET");
  });

  it("the pool still runs for the right role afterwards", async () => {
    expect(await app.withTenant(A.clinicId, ownPatients)).toEqual([A.patientId]);
  });
});
