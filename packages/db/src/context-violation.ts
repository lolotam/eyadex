/**
 * الـ wrapper بيفتح transaction بعيادة ودور وسقوف وقت معيّنين، وبيقفلها بنفس الشروط دي.
 * لو الكود جوه `fn` غيّر أي حاجة فيهم، الـ commit ما يحصلش: الـ error ده بيمرّ على نفس مسار
 * الـ rollback، فالشغل كله بيروح تاني.
 *
 * الرسالة بتسمّي **اللي اتغيّر** وبس: مفيش قيم ولا أسماء أعمدة ولا معرّفات عيادات، لأن الخطأ
 * بيعدّي لـ log وتتبع (ADR-0002).
 */

/** أي شرط من شروط الجلسة وقع ضدّها الـ transaction. */
export type TenantContextBreach =
  | "clinic"
  | "fresh-clinic"
  | "role"
  | "statement-timeout"
  | "idle-timeout"
  | "unfinished-savepoint"
  | "unfinished-statement";

const MESSAGES: Record<TenantContextBreach, string> = {
  clinic:
    "The transaction no longer runs for the clinic the wrapper opened it for — app.clinic_id was " +
    "re-pointed, or the transaction was committed or rolled back by hand (ADR-0002)",
  "fresh-clinic":
    "withNewTenant generated an id that already belongs to a clinic, so onboarding would write into " +
    "an existing clinic — the wrapper refuses before fn starts (ADR-0002)",
  role:
    "The connection is no longer the runtime role the wrapper requires — the role was changed " +
    "inside fn, so nothing is committed (ADR-0002)",
  "statement-timeout":
    "The statement_timeout the wrapper set is no longer in force — it was changed inside fn, so " +
    "nothing is committed (ADR-0002)",
  "idle-timeout":
    "The idle_in_transaction_session_timeout the wrapper set is no longer in force — it was " +
    "changed inside fn, so nothing is committed (ADR-0002)",
  "unfinished-savepoint":
    "fn returned while a tx.transaction(...) savepoint it started was still running — it would " +
    "have kept running after the commit, so nothing is committed; await every tx.transaction " +
    "(ADR-0002)",
  "unfinished-statement":
    "fn returned while a tx.execute(...) it started was still running — fn never saw its result, " +
    "so nothing is committed; await every tx.execute (ADR-0002)",
};

/**
 * خرق في سياق الـ transaction: الـ wrapper شاف حاجة مش زي ما هو ماسكها، فجّهش COMMIT.
 * مش زي `DatabaseError`: دي مش مشكلة SQL، دي محاولة تعدّي على العقد اللي الـ wrapper راهبه.
 */
export class TenantContextViolationError extends Error {
  override readonly name = "TenantContextViolationError";
  /** أي شرط وقع — الاسم بس، من غير أي قيمة اتقريت. */
  readonly breach: TenantContextBreach;

  constructor(breach: TenantContextBreach) {
    super(MESSAGES[breach]);
    this.breach = breach;
  }
}

/**
 * ليه فحصة `pg_auth_members` مهمّة أصلاً (مش زيادة حِذر):
 *
 * `SET ROLE` جوه transaction محتاج عضوية. لو الدور التشغيلي كان عضو في أي دور تاني، جوه `fn`
 * ينفع يتحوّل لدور BYPASSRLS أو `pg_monitor` أو `pg_read_all_data`، ومن ساعتها بتضّيع كل الفحوصات
 * (الصلاحية، الـ RLS، الـ timeouts) بتquit日和 الـ `SET ROLE` بيرجع `current_user` تاني.
 *
 * بالمنع بقاء `pg_auth_members` فاضي، `SET ROLE` جوه `fn` ما بيقدرش ينجح أصلاً — مفيش عضو
 * يعني مفيش دور تاني يتحول ليه. و`SET SESSION AUTHORIZATION` محتاج superuser، ودور التشغيل
 * مش superuser (أول statement بيرفض `rolsuper`). فحص `current_user`/`session_user` في الـ
 * statement الأخير يبقى خط الدفاع الأخير، لا أكثر.
 */
