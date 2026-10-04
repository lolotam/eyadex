import { sql, type SQL } from "drizzle-orm";
import type { Sql } from "postgres";
import { expect } from "vitest";

import { ForbiddenStatementError, type Database, type Tx } from "../index.ts";
import { idList, newTestId, type ClinicFixture } from "./test-database.ts";

/** العيارتان والداتابيز اللي الـ refusal tests بتشتغل عليهم — كل ملف بيعمل الـ fixtures بتاعه. */
export interface RefusalFixture {
  readonly app: Database;
  readonly owner: Sql;
  readonly A: ClinicFixture;
  readonly B: ClinicFixture;
}

/** كتابة سطر في جدول الفروع — بتتعمل قبل الجملة المرفوضة عشان نشوف لو اتحفظت. */
export const insertBranch = (tx: Tx, clinicId: string, probe: string): Promise<unknown> =>
  tx.execute(sql`
    INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
    VALUES (${clinicId}, ${probe}, 'مسبار', 'Probe', true, now(), now())
  `);

/** كل مراجع A والـ B من جوه `withTenant(A)` — لازم يطلعوا A بس. */
export const seenPatients = async (
  tx: Tx,
  A: ClinicFixture,
  B: ClinicFixture,
): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
  );
  return rows.map((row) => row.id);
};

/**
 * بيثبت إن الجملة **ماترسلتش**، مش بس إن الـ error طلع:
 *
 * 1. الكتابة اللي اتعملت قبل الجملة المرفوضة ماتت مع الـ rollback. لو الجملة كانت اتنفذت
 *    (`COMMIT` مثلاً) الكتابة كانت هتفضل محفوظة، فوجودها أو غيابها دليل على اللي حصل.
 * 2. العيادة ما اتحوّلتش: A لسه شايفة صفوفها بس في transaction جديدة.
 * 3. الرسالة مفيهاش الـ SQL ولا الـ parameters ولا أي معرّف ولا كلمة من الجملة المرفوضة. الـ
 *    allowed kinds بتتقال عمداً — دي معلومات بتقول للـ caller يكتب إيه، مش نص من الجملة دي.
 *
 * @param fixture الـ database والعيارتين
 * @param statement الجملة اللي المفروض تترفض
 * @param keyword الاسم اللي المفروض يتسمّى في الرفض
 * @returns الـ error المرمي
 */
export async function refuses(
  fixture: RefusalFixture,
  statement: SQL,
  keyword: string,
): Promise<ForbiddenStatementError> {
  const { app, owner, A, B } = fixture;
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
  const refusal = failure as ForbiddenStatementError;
  expect(refusal.keyword).toBe(keyword);
  expect(refusal).toBeInstanceOf(TypeError);
  expect(await owner`SELECT id FROM branches WHERE id = ${probe}`).toHaveLength(0);
  expect(await app.withTenant(A.clinicId, (tx) => seenPatients(tx, A, B))).toEqual([A.patientId]);
  for (const text of [refusal.message, String(refusal.stack), JSON.stringify(refusal)]) {
    for (const secret of [
      A.clinicId,
      B.clinicId,
      A.patientId,
      B.patientId,
      probe,
      "app.clinic_id",
      "statement_timeout",
      "pg_catalog",
      "'",
    ]) {
      expect(text).not.toContain(secret);
    }
  }
  return refusal;
}
