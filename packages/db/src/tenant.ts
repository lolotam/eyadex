import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { asDatabaseError } from "./database-error.ts";
import { guardTransaction, type Tx } from "./guarded-tx.ts";
import { assertNotNested, insideTransaction } from "./nested-guard.ts";
import { withStartDeadline } from "./start-deadline.ts";
import type { IdGenerator, DatabaseRole } from "./options.ts";
import {
  closeSession,
  openSession,
  sessionExecutor,
  type SessionExpectation,
} from "./session-check.ts";
import { assertUuid } from "./uuid.ts";

export type { Tx } from "./guarded-tx.ts";

/**
 * النقط التلاتة للداتابيز (ADR-0002). كل واحدة transaction واحدة بس — ما فيش transaction
 * متداخل ولا connection خام يخرج بره.
 */
export interface TenantWrappers {
  withTenant<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  withNewTenant<T>(fn: (tx: Tx, clinicId: string) => Promise<T>): Promise<T>;
  withNoTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * بيبني النقط التلاتة فوق client واحد من غير ما يطلع بره. كل wrapper بيحط الإعدادات دي في أول
 * statement جوه الـ transaction بتاعته — والإعدادات دي **transaction-local** (`set_config(…, true)`)،
 * فالـ rollback بيليمها كمان.
 *
 * ترتيب كل transaction:
 *
 * 1. `openSession` — أول statement بيحطّ `app.clinic_id` (سطر فاضي في `withNoTenant`) +
 *    `statement_timeout` + `idle_in_transaction_session_timeout`، وبيرفض لو الدور مش
 *    `options.role` أو متفوّت أو عضو في أي دور تاني. لو رفض، `fn` مش بتتنفّذ خالص. الجملة دي
 *    بتمرّ على الـ transaction الحقيقية (`sessionExecutor`) مش على `tx.execute` المحروس: هي
 *    اللي بتحطّ `set_config`، فحارس الـ statement لو شافها كانت هترفض شغل الـ wrapper نفسه.
 * 2. `fn(guardedTx)` — بشيء محمي: `execute` (وحده باب الـ SQL، وبيفلتر جمل فتح/إغلاق الـ
 *    transaction وتغيير الجلسة)، و`transaction` للـ savepoints، و`rollback`. مفيش بانيهات
 *    استعلام ولا `tx.session`.
 * 3. `closeSession` — آخر statement قبل الـ COMMIT، بيقرا الجلسة تاني وبيمسح
 *    `app.clinic_id` على مستوى الـ session. الطبقة التانية دفاع بعد حارس الـ statement.
 * 4. الـ COMMIT بتاع Drizzle، وبعدها الـ `Tx` بيتبطل (`Proxy.revocable`) — فـ handle محفوظ جوه
 *    `fn` بيرمي `TypeError` على أي استخدام بعد ما الـ transaction يخلص، وبيشتغل على الـ pool
 *    لو اتسايب مفتوح. مش مرجوع كقيمة من `fn` كمان: `await` بيقرا `.then` واللي مش في
 *    الـ allow-list، فالـ COMMIT ما بيحصلش أصلاً.
 *
 * ليه `''` صريح في `withNoTenant`: الـ connection اللي رجعت من الـ pool ممكن يكون عليها
 * `app.clinic_id` على مستوى الـ session (من كود تاني أو من اتصال قديم)، و`set_config(…, true)`
 * جوه transaction بيلغي أي قيمة session-level جوّه الـ transaction دي بس. من غير السطر الفاضي،
 * `withNoTenant` ممكن يورث عيادة من transaction قبله ويدوّر على صفوفها.
 *
 * @param db الـ Drizzle client — بيفضل جوه الـ closure
 * @param role الدور اللي اللينك لازم يكون داخل بيه (PRD §4.5)
 * @param timeoutMs سقف الـ statement وسكون الـ transaction بالـ ms
 * @param ids مولّد الـ ids بتاع `withNewTenant`
 * @param instance token الـ `Database` ده، عشان التداخل يترفض على نفس الـ instance بس
 * @param startDeadlineMs سقف بداية الـ transaction من ناحية JS (شوف `start-deadline.ts`)
 * @returns النقط التلاتة
 */
export function createTenantWrappers(
  db: PostgresJsDatabase,
  role: DatabaseRole,
  timeoutMs: number,
  ids: IdGenerator,
  instance: object,
  startDeadlineMs: number,
): TenantWrappers {
  const inOne = <T>(
    expected: SessionExpectation,
    fn: (tx: Tx) => Promise<T>,
    freshClinic = false,
  ): Promise<T> =>
    insideTransaction(instance, async () => {
      try {
        return await withStartDeadline(startDeadlineMs, (began) =>
          db.transaction(async (raw) => {
            began();
            // الـ executor بتاع الـ wrapper: على الـ transaction الحقيقية، وبيفضل في الـ closure.
            const executor = sessionExecutor(raw);
            await openSession(executor, expected, freshClinic);
            const guarded = guardTransaction(raw);
            try {
              const result = await guarded.finish(fn);
              await closeSession(executor, expected);
              return result;
            } finally {
              // COMMIT or ROLLBACK, the guarded tx dies with it: a kept handle runs on the pool.
              guarded.revoke();
            }
          }),
        );
      } catch (error) {
        throw asDatabaseError(error);
      }
    });

  const run = <T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    inOne({ role, clinicId, timeoutMs }, fn);

  // كل الـ async functions عشان الـ validation يرجع rejected promise زي أي فشل تاني، مش exception
  // متزامن يتفاوت مع بقية الأخطاء.
  return {
    // async مقصود: id غلط لازم يبقى rejected promise، ومايتبعتش أي query.
    withTenant: async (clinicId, fn) => {
      assertNotNested("withTenant", instance);
      return await run(assertUuid(clinicId, "clinicId"), fn);
    },
    withNoTenant: async (fn) => {
      assertNotNested("withNoTenant", instance);
      return await run("", fn);
    },
    withNewTenant: async (fn) => {
      assertNotNested("withNewTenant", instance);
      if (role !== "eyadex_platform") {
        throw new TypeError(
          "withNewTenant is the onboarding path and needs role eyadex_platform — eyadex_app cannot create a clinic (ADR-0002)",
        );
      }
      const clinicId = assertUuid(ids.newId(), "generated clinicId");
      // freshClinic: الـ id لازم يكون جديد فعلاً، وإلا الـ onboarding هتكتب جوه عيادة موجودة.
      return await inOne({ role, clinicId, timeoutMs }, (tx) => fn(tx, clinicId), true);
    },
  };
}
