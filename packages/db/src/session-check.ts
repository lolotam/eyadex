import { sql } from "drizzle-orm";

import { TenantContextViolationError } from "./context-violation.ts";
import type { Tx } from "./guarded-tx.ts";
import type { DatabaseRole } from "./options.ts";

/**
 * الفحوصات بتاعة الجلسة: أول statement في كل transaction (مين أنا، powers بتاعتي، وسقوف
 * الوقت) وآخر statement قبل الـ COMMIT (إن الجوا زي ما الـ wrapper فتحه). الاتنين في نفس
 * round trip: الأول بيرفض بدور غلط قبل `fn`، التاني بيرمي `TenantContextViolationError`
 * قبل الـ COMMIT.
 */

/** الـ part من `Tx` اللي الفحوصات محتاجاه — `execute` بس. */
type Executor = Pick<Tx, "execute">;

/** إيه اللي الـ transaction بتعرفه عن نفسها. نوع alias مش interface عشان يبقى indexable. */
type SessionFacts = {
  readonly db_role: string;
  readonly login_role: string;
  readonly privileged: boolean;
  readonly member_of_another_role: boolean;
  readonly clinic: string;
  readonly statement_timeout: string;
  readonly idle_timeout: string;
  readonly clinic_absent?: boolean;
};

/** اللي الـ statement الأخير بيقراه تاني. */
type ClosingFacts = {
  readonly clinic: string | null;
  readonly db_role: string;
  readonly login_role: string;
  readonly statement_timeout: string;
  readonly idle_timeout: string;
};

/** وش الـ wrapper بيفتح بيه الـ transaction. */
export type SessionExpectation = {
  readonly role: DatabaseRole;
  readonly clinicId: string;
  readonly timeoutMs: number;
};

/** وحدات مدّة PostgreSQL بالـ text — عشان نقارن الأرقام مش النصوص. */
const DURATION_UNITS: Record<string, number> = {
  us: 0.001,
  ms: 1,
  s: 1_000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION = /^(\d+)(us|ms|s|min|h|d)?$/;

/**
 * `current_setting('statement_timeout')` بترجّع `10s` بعد ما الـ wrapper يحط `10000ms`، فالمقارنة
 * لازم تكون رقمية. أي نص مش مدّة (زي `-1` يعني "من غير حد") بيرجّع undefined، وده معناه اتغيّر.
 *
 * @param value النص اللي PostgreSQL رجّعه
 * @returns المدّة بالـ ms أو undefined
 */
export const durationMs = (value: string | null | undefined): number | undefined => {
  if (typeof value !== "string") return undefined;
  const match = DURATION.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const size = DURATION_UNITS[unit];
  return size === undefined ? undefined : Math.round(amount * size);
};

/**
 * رسالة الرفض بتسمّي الدور المتوقّع وبس. الرابط وكلمة السر موجودين في `options.url` وما
 * بيوصلوش لأي error، وده مثبّت في `roles.db.spec.ts`.
 *
 * @param expected الدور اللي `options.role` طالبه
 * @param facts اللي اتقري، أو undefined لو الـ statement نفسها فشلت
 * @returns الخطأ اللي يترمي قبل `fn`
 */
const refuseRole = (expected: DatabaseRole, facts: SessionFacts | undefined): Error => {
  const expectation = `the connection must log in as ${expected}`;
  if (facts === undefined || facts.privileged !== false || facts.member_of_another_role !== false) {
    return new Error(
      `Refusing to run tenant work on a role that carries more power than ${expected} — ${expectation}, ` +
        "and it must not be superuser, must not bypass RLS and must not be a member of any role (ADR-0002)",
    );
  }
  if (facts.login_role !== expected) {
    return new Error(
      `Refusing to run tenant work after the role changed — ${expectation}, and session_user must still be ${expected} (ADR-0002)`,
    );
  }
  return new Error(`Refusing to run tenant work on another role — ${expectation} (ADR-0002)`);
};

/**
 * أول statement في الـ transaction: بيحطّ `app.clinic_id` و`statement_timeout` و
 * `idle_in_transaction_session_timeout` **transaction-local**، وبيرجّع مقروءات الجلسة.
 *
 * شروط الرفض: `current_user` غير الدور المطلوب، أو `session_user` مختلف (يعني `SET ROLE`
 * حصل)، أو superuser/BYPASSRLS، أو عضو في أي دور تاني (`pg_auth_members`) — عضو في دور
 * BYPASSRLS أو `pg_monitor` أو `pg_read_all_data` يعني إن `SET ROLE` جوه `fn` بيوصل لصفوف
 * برّه الـ RLS.
 *
 * `OFFSET 0` مقصود: من غيره PostgreSQL بيرفع الـ subquery ويشيل مخرجاته اللي مش مستعملة،
 * وممكن يمسح `set_config` بصمت.
 *
 * @param tx الـ `Tx` المحمي بتاع نفس الـ transaction
 * @param expected الدور والعيادة والسقف الزمني اللي الـ wrapper افتح بيه
 * @param freshClinic `withNewTenant` بس: كمان يتأكد إن الـ id ده لسه مش عيادة موجودة
 * @throws Error دور غلط أو متفوّت، و`TenantContextViolationError` لو الـ id مش جديد
 */
export async function openSession(
  tx: Executor,
  expected: SessionExpectation,
  freshClinic = false,
): Promise<void> {
  const limit = `${expected.timeoutMs}ms`;
  const rows = await tx.execute<SessionFacts>(sql`
    SELECT opened.db_role, opened.login_role, opened.privileged, opened.member_of_another_role,
           opened.clinic, opened.statement_timeout, opened.idle_timeout
           ${freshClinic ? sql`, (SELECT NOT EXISTS (SELECT 1 FROM clinics WHERE id = NULLIF(opened.clinic, '')::uuid) AS clinic_absent)` : sql``}
    FROM (
      SELECT current_user AS db_role,
             session_user AS login_role,
             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged,
             EXISTS (
               SELECT 1 FROM pg_auth_members m
               WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             ) AS member_of_another_role,
             set_config('app.clinic_id', ${expected.clinicId}, true) AS clinic,
             set_config('statement_timeout', ${limit}, true) AS statement_timeout,
             set_config('idle_in_transaction_session_timeout', ${limit}, true) AS idle_timeout
    ) AS opened OFFSET 0
  `);
  const facts = rows[0];
  if (
    facts === undefined ||
    facts.privileged !== false ||
    facts.member_of_another_role !== false ||
    facts.db_role !== expected.role ||
    facts.login_role !== expected.role
  ) {
    // Throwing here rolls the transaction back, so the clinic context never reaches fn and the
    // settings die with it — a superuser URL cannot read another clinic's rows even once.
    throw refuseRole(expected.role, facts);
  }
  if (freshClinic && facts.clinic_absent !== true) {
    throw new TenantContextViolationError("fresh-clinic");
  }
}

/**
 * آخر statement قبل الـ COMMIT: بيقرا الجلسة تاني وبيمسح `app.clinic_id` على مستوى الـ
 * session، فمفيش قيمة عيادة بتبقى عالـ connection بعد ما الـ transaction يخلص.
 *
 * الترتيب هنا متعمّد مش صدفة: القراءة جوه `FROM ... OFFSET 0` (منع رفع الـ subquery)،
 * و`set_config` في الـ target list بتاع الـ query نفسه، فاللي فاتح مستحيل يتحطّ قبل
 * القراءة. لو `fn` غيّر العيادة أو الدور أو السقوف، أو عمل COMMIT/ROLLBACK بإيده (والتالي
 * بيرمي قيمة الـ transaction-local بعيد)، الـ error ده بيروح على نفس مسار الـ rollback.
 *
 * @param tx الـ `Tx` المحمي بتاع نفس الـ transaction
 * @param expected نفس القيم اللي `openSession` فتحت بيها
 * @throws TenantContextViolationError أول ما تختلف أي حاجة
 */
export async function closeSession(tx: Executor, expected: SessionExpectation): Promise<void> {
  const rows = await tx.execute<ClosingFacts>(sql`
    SELECT opened.clinic, opened.db_role, opened.login_role,
           opened.statement_timeout, opened.idle_timeout,
           set_config('app.clinic_id', '', false) AS session_clinic_cleared
    FROM (
      SELECT current_setting('app.clinic_id', true) AS clinic,
             current_user AS db_role,
             session_user AS login_role,
             current_setting('statement_timeout') AS statement_timeout,
             current_setting('idle_in_transaction_session_timeout') AS idle_timeout
    ) AS opened OFFSET 0
  `);
  const facts = rows[0];
  if (facts === undefined || facts.clinic !== expected.clinicId) {
    throw new TenantContextViolationError("clinic");
  }
  if (facts.db_role !== expected.role || facts.login_role !== expected.role) {
    throw new TenantContextViolationError("role");
  }
  if (durationMs(facts.statement_timeout) !== expected.timeoutMs) {
    throw new TenantContextViolationError("statement-timeout");
  }
  if (durationMs(facts.idle_timeout) !== expected.timeoutMs) {
    throw new TenantContextViolationError("idle-timeout");
  }
}
