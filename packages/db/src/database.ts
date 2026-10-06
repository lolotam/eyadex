import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { asDatabaseError } from "./database-error.ts";
import { assertNotNested, insideTransaction } from "./nested-guard.ts";
import { applicationName, resolveOptions, type DatabaseOptions } from "./options.ts";
import { openSession, sessionExecutor } from "./session-check.ts";
import { withStartDeadline } from "./start-deadline.ts";
import { createTenantWrappers, type Tx } from "./tenant.ts";

/**
 * كل اللي أي app بياخده من الداتابيز. مفيش client خام ولا Drizzle instance في الـ shape: أي query
 * لازم يعدّي على `withTenant` / `withNewTenant` / `withNoTenant` (CLAUDE.md §5، ADR-0002).
 */
export interface Database {
  /**
   * شغل عيادة واحدة. `app.clinic_id` بيتحط على الـ id ده في أول الـ transaction، فكل policy بيشوف
   * صفر صفوف من أي عيادة تانية — من غير context = صفر صفوف، مش error.
   *
   * ده عزل مش صلاحيات: الـ id بيتسلّم جاهز، واللي بيتأكد إن العيادة مسموحة للمستخدم هو
   * CLAUDE.architecture.md §3 فوق الـ wrapper.
   *
   * @param clinicId uuid العيادة
   * @param fn الشغل جوه الـ transaction
   * @returns نتيجتها
   */
  withTenant<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * onboarding: عيادة جديدة، والدور `eyadex_platform` بس. الـ id بيتولّد بـ `options.ids` ويتحط
   * `app.clinic_id` زي أي عيادة، فالـ RLS لسه مربوط بالعيادة الجديدة — بس لو الـ id ده عيادة
   * موجودة بالفعل، الـ wrapper بيرفض قبل `fn`.
   *
   * @param fn شغل الـ onboarding، بياخد الـ transaction والـ id الجديد
   * @returns نتيجتها
   */
  withNewTenant<T>(fn: (tx: Tx, clinicId: string) => Promise<T>): Promise<T>;
  /**
   * من غير عيادة: `app.clinic_id` بيتحط فاضي صريح، فكل جدول عيادة بيرجع صفر صفوف. المسار الوحيد
   * المسموح بيه قبل ما تكون عيادة معروفة: `invitation_clinic_for_token` (0014) و`membership_clinic_for_user` (0027).
   *
   * @param fn الشغل جوه الـ transaction
   * @returns نتيجتها
   */
  withNoTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** للـ `/ready`: نفس فحص الجلسة بتاع الـ wrappers جوه transaction قصير (الدور، الـ memberships، والصلاحيات). */
  ping(): Promise<void>;
  /** قفل محدود: postgres.js بيقفل الـ connections بدل ما يستنى للأبد. */
  close(): Promise<void>;
}

/**
 * بيفتح pool على الدور المطلوب في `options.role` وبيرجّع النقط التلاتة + ping + close بس.
 * postgres.js كسلان، فبنتج الداتابيز ده **مبيفتحش اتصال**: تشغيل الـ app مش محتاج داتابيز.
 *
 * @param options الرابط والدور ومولّد الـ ids وحجم الـ pool وسقف الـ transaction
 * @returns الـ `Database` المغلقة على الـ client
 */
export function createDatabase(options: DatabaseOptions): Database {
  const resolved = resolveOptions(options);
  const client = postgres(resolved.url, {
    max: resolved.maxConnections,
    // حدّ لفتح الـ connection: من غيره `ping` على host بياكل الـ packets بيضل مستني TCP
    // (~2 دقيقة افتراضياً في postgres.js) بدل ما يفشل بسرعة.
    connect_timeout: resolved.connectTimeoutSeconds,
    // postgres.js 3.4.9 discards the promise of its pg_type lookup on every new connection: if that
    // query fails, the raw PostgresError is an unhandled rejection outside asDatabaseError and can
    // end the process (porsager/postgres#1192, Codex on PR #22). Only built-in types are used here.
    fetch_types: false,
    // الإشعارات كانت بتطبع على stderr من جوه الكود، والباكاج ده ممنوع يطبع حاجة (CLAUDE.md §8).
    onnotice: () => undefined,
    connection: { application_name: applicationName(resolved.role) },
  });
  const db = drizzle(client);
  const expected = {
    role: resolved.role,
    clinicId: "",
    timeoutMs: resolved.transactionTimeoutMs,
  };
  // token الـ Database ده: الـ nesting guard بيرفض على نفس الـ instance بس، فـ transaction على
  // دور تاني (pool تاني) جوه transaction على ده يفضل شغال عادي.
  const instance: object = {};
  // connect_timeout alone does not bound a cleanly closed socket (porsager/postgres#1193).
  const startDeadlineMs = resolved.connectTimeoutSeconds * 1000 + resolved.transactionTimeoutMs;
  return {
    ...createTenantWrappers(
      db,
      resolved.role,
      resolved.transactionTimeoutMs,
      resolved.ids,
      instance,
      startDeadlineMs,
    ),
    // /ready مش معناه SELECT 1: DATABASE_URL على eyadex_auth أو على الـ owner هيعدّي ثم يفشل أول
    // query عيادة من غير error مفهوم. فـ ping بيعمل نفس أول statement بتاع الـ wrappers، جوه
    // transaction، بسقف الوقت نفسه. مفيش `fn` هنا، فمفيش `Tx` محمي — executor على الـ transaction
    // الحقيقية زي الـ wrappers بالظبط.
    ping: async (): Promise<void> => {
      assertNotNested("ping", instance);
      return insideTransaction(instance, async () => {
        try {
          await withStartDeadline(startDeadlineMs, (began) =>
            db.transaction(async (raw) => {
              began();
              await openSession(sessionExecutor(raw), expected);
            }),
          );
        } catch (error) {
          throw asDatabaseError(error);
        }
      });
    },
    close: async (): Promise<void> => {
      await client.end({ timeout: 5 });
    },
  };
}
