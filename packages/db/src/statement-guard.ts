/**
 * حارس الـ statement: `fn` بيبعت SQL مربوط، والكلام ده بيفحص **الجملة نفسها** قبل ما تتبعت.
 *
 * الحارس ده **guard-rail مش sandbox**: `fn` كود تطبيق موثوق بيشتغل في نفس الـ process، وممكن
 * لوحده يفتح connection تانية. اللي بيعمله هنا إن العقد بتوع الـ wrapper (الـ transaction
 * بتاعت، `app.clinic_id`، السقوف) **مالهاش** طريقة يتخدع بيها جملة واحدة، وإن أي كود جوه
 * `fn` بيغلط بيترفض قبل الإرسال بدل ما يغيّر الجلسة في صمت.
 *
 * ليه allow-list للكلمة الأولى مش deny-list: أي كلمة ما حطينهاش في القائمة ماشي جواها — من
 * `ALTER ROLE` (بيغيّر سقف الدور لكل الجلسات الجاية) لحد `EXECUTE` (بيشغّل جملة معمّاة
 * سميتها postgres.js في `pg_prepared_statements`) و`GRANT` و`TRUNCATE` و`VACUUM`.
 * `fn` محتاجة من SQL حاجتين: تقرأ أو تكتب صفوف. `SELECT` و`INSERT` و`UPDATE` و`DELETE` و
 * `WITH` و`VALUES` و`TABLE` و`MERGE` بالظبط دول اللي بتعمل كده، فأي حاجة غيرها مرفوضة.
 *
 * وإيه معنى إن allow-list الكلمة الأولى sound؟ الـ extended protocol في PostgreSQL بينفّذ **جملة
 * واحدة بالظبط** في كل نداء (`Parse`/`Bind`/`Execute`)، فمفيش `COMMIT` تاني ورا `SELECT` **لما
 * الجملة تكون مربوطة**. بس postgres.js ما بيختارش الـ extended لما الجملة **من غير parameters**
 * — بيسيب `simple: args.length === 0` (شوف `postgres/src/index.js`)، والـ simple protocol
 * بيقبل جمل متعدّدة في نداء واحد. ساعتها `SELECT 1; COMMIT` بيعدّي من فحص الكلمة الأولى
 * وبيـ commit نص الشغل (`FunctionScan` بيـ commit جوّه الـ function)، فالحارس بيرفض أي `;`
 * وراه محتوى. الـ `;` الأخيرة لوحدها (زي `SELECT 1;`) مسموحة.
 *
 * وكل الفحوصات اللي على **المحتوى** — `set_config`، ودوال تنفيذ النص، و`U&` — بتتم على **النص
 * الخام**، مش على الـ body المنزوع التعليقات. الـ body بيتقرأ عشان نعرف نوع الجملة بس؛ لو
 * الفحص بيتم عليه كان `-- set_config` جوه comment بيكفي عشان يرفض جملة شرعية، والأسوأ إن
 * `--\rselect set_config(...)` كان بينعدّي لأن الـ comment السطري في PostgreSQL بيخلص عند
 * `\r` كمان.
 *
 * الفحص fail-closed في كل المواضع اللي القراءة فيها مش يقينية: قيمة بين `'...'` فيها
 * `set_config`، أو `;` جوه literal، أو `U&` بيحطّ حروف الاسم — كلهم مرفوضين. الـ cost إن
 * query شرعية واحدة ترفضها وتتعامل معاها في الكود، والبديل إن عقد الـ wrapper يبقى قابل
 * للخرق بكلمة.
 *
 * الـ statements بتوع الـ wrapper نفسه — فتح الجلسة وإغلاقها — **مش** بيعدّوا على الحارس دول:
 * هما اللي بيحطّوا `set_config` وبيقراوا `app.clinic_id`، يعني الحارس لو شافهم كان هيرفض شغل
 * الـ wrapper نفسه. بيمشوا على الـ transaction الحقيقية من جوه الباكاج (شوف `session-check.ts`)،
 * واللي بياخدهم `fn` هو `Tx` المحمي بس.
 */

import { lexStatement } from "./sql-lexer.ts";

/**
 * أنواع الجمل اللي `fn` تقدر تبعتها — والقائمة دي هي **كل** اللي بيعمل قراءة أو كتابة صفوف.
 * `TABLE branches` جملة قراءة مستقلة، و`MERGE` كتابة بشرط، و`VALUES` جملة بتبني صفوف.
 *
 * كل ما بره دي ممنوع، حتى لو كلمة مضمّرة جوه جملة تانية (زي `SET` جوه `UPDATE … SET` —
 * دي جملة مسموحة، بس `SET` كأول كلمة لأ).
 */
export const ALLOWED_STATEMENT_WORDS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "WITH",
  "VALUES",
  "TABLE",
  "MERGE",
] as const;

/** الدالة اللي هي الطريق الوحيد لتغيير العيادة أو السقوف من جوه جملة عادية. */
const SET_CONFIG = /set_config/i;

/**
 * `pg_settings` view عليها rule: `UPDATE pg_settings SET setting = … WHERE name = …` هي
 * `set_config(name, setting, false)` — على مستوى الـ **session**، من غير ما الكلمة تظهر. فبتحرّك
 * `app.clinic_id` والسقوف وتعدّي الـ COMMIT. القراءة منها كمان بترفض (fail closed): مفيش use case
 * محتاجها. (Codex على PR #22، P2.)
 */
const PG_SETTINGS = /pg_settings/i;

/** كلمة تقرير `pg_settings`. */
export const PG_SETTINGS_KEYWORD = "pg_settings";

/**
 * `U&` جوه معرّف `"…"` أو نص `'…'`: الـ escapes بتكتب أي اسم من غير ما حروفه تبان في النص،
 * فـ `U&"set\005fconfig"` هو `set_config` كتابتها مختلفة. القاعدة مش إننا نحلّ الـ escapes —
 * القاعدة إن **كل** `U&` يترفض، ومفيش caller شرعي بيكتبهم.
 */
const UNICODE_ESCAPE = /u&["']/i;

/**
 * دوال PostgreSQL اللي **بتنفّذ SQL مكتوب نصاً** جواها — وهي، مع `set_config`، القائمة
 * الوحيدة من دوال الـ core اللي تقدر تحرّك العيادة من جملة مفيش فيها كلمة ممنوعة:
 * `query_to_xml` بيبني الاستعلام من الـ arguments، و`ts_stat` بيشغّل النص على الـ query
 * ويشرحه، و`ts_rewrite` بياخد نص وبيحوّله، و`cursor_to_xml` بيفسّر كود (statement) معمّى.
 *
 * دي **قائمة مغلقة**: أي حاجة بتعمل كده لازم تنضاف هنا أو ما تتسطّبش في الداتابيز أصلاً
 * (ADR-0002).
 */
export const TEXT_EXECUTING_FUNCTIONS = [
  "query_to_xml",
  "query_to_xmlschema",
  "query_to_xml_and_xmlschema",
  "cursor_to_xml",
  "cursor_to_xmlschema",
  "ts_stat",
  "ts_rewrite",
] as const;

/**
 * دوال بيفضل أثرها **بعد** الـ COMMIT أو بيوصل لـ connections تانية — حاجة ولا الـ closing check
 * ولا الـ rollback بيشيلوها:
 *
 * - `pg_advisory_lock*` و`pg_try_advisory_lock*` على مستوى الـ session: القفل بيفضل ماسك في الـ
 *   connection اللي رجعت للـ pool، وأي transaction تانية بتستنى نفس المفتاح بتقف لحد الـ timeout.
 *   نسخ الـ transaction (`pg_advisory_xact_lock*`) بتتفك مع الـ COMMIT، فهي مسموحة — وأسماءها مش
 *   بتحتوي الأسماء دي، فالفحص بالـ substring ما بيلمسهاش.
 * - `pg_terminate_backend` و`pg_cancel_backend`: الدور يقدر يبعت إشارة لأي connection تانية لنفس
 *   الدور، يعني transaction عيادة تقدر توقف شغل عيادة تانية.
 *
 * (Codex على PR #22، P2.)
 */
export const SESSION_SCOPED_FUNCTIONS = [
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_try_advisory_lock",
  "pg_try_advisory_lock_shared",
  "pg_terminate_backend",
  "pg_cancel_backend",
] as const;

/**
 * نسخة case-insensitive لكل دالة، الأطول الأول: `query_to_xml` اسم `query_to_xmlschema` برضه،
 * فالترتيب الطويل الأول يخلي الرسالة تسمّي الدالة اللي اتكتبت فعلاً.
 */
const longestFirst = (names: readonly string[]) =>
  [...names]
    .sort((left, right) => right.length - left.length)
    .map((name) => [name, new RegExp(name, "i")] as const);

const TEXT_EXECUTING = longestFirst(TEXT_EXECUTING_FUNCTIONS);

const SESSION_SCOPED = longestFirst(SESSION_SCOPED_FUNCTIONS);

/** كلمة تقرير لرفض أكتر من statement في نداء واحد — postgres.js بيستخدم الـ simple protocol وقتها. */
export const MULTIPLE_STATEMENTS = "multiple statements";

/** كلمة تقرير لما مفيش أول كلمة خالص — نص فاضي أو تعليق بس. */
export const EMPTY_STATEMENT = "empty statement";

/** كلمة تقرير لتعليق بلوكي مفتوح: النص كله غير قابل للقراءة. */
export const UNTERMINATED_COMMENT = "unterminated comment";

/** كلمة تقرير الـ `U&` — الكلمة نفسها بتظهر في الرسالة، زي `set_config`. */
export const UNICODE_ESCAPE_KEYWORD = "U&";

/** الأنواع المسموحة في رسالة الرفض — عشان `fn` تعرف بتكتب إيه بدل ما تخمّن. */
const ALLOWED_LIST = "SELECT, INSERT, UPDATE, DELETE, WITH, VALUES, TABLE and MERGE";

const ALLOWED_FIRST_WORD: ReadonlySet<string> = new Set(ALLOWED_STATEMENT_WORDS);

/**
 * جملة ممنوعة: ترمي `ForbiddenStatementError` قبل أي إرسال، والرسالة بتسمّي الكلمة أو اسم
 * الدالة بس — ولا الـ SQL ولا الـ parameters ولا قيم ولا معرّفات عيادات.
 *
 * مش `DatabaseError`: دي مش مشكلة SQL، دي محاولة تبعت جملة العقد نفسه بيمنعها.
 */
export class ForbiddenStatementError extends TypeError {
  override readonly name = "ForbiddenStatementError";
  /** الكلمة أو الدالة اللي اترفضت — الاسم بس. */
  readonly keyword: string;

  constructor(keyword: string) {
    super(messageFor(keyword));
    this.keyword = keyword;
  }
}

/**
 * سبب الرفض في جملة واحدة، جملة واحدة وصفر SQL. كل حالة ليها سبب مختلف، والرسالة بتقوله
 * بالظبط عشان الـ engineer يلاقي السبب من غير ما يقرا النص المرفوض.
 *
 * @param keyword الكلمة أو اسم الدالة اللي اترفضت
 * @returns الرسالة
 */
function messageFor(keyword: string): string {
  if (keyword === "set_config") {
    return (
      "tx.execute() refuses any statement that mentions set_config: it is the only way a statement " +
      "can re-point the clinic or a timeout, and the wrapper owns both (ADR-0002)"
    );
  }
  if (keyword === PG_SETTINGS_KEYWORD) {
    return (
      "tx.execute() refuses any statement that mentions pg_settings: an UPDATE of that view is " +
      "set_config at session level, so it could re-point the clinic or a timeout (ADR-0002)"
    );
  }
  if (keyword === UNICODE_ESCAPE_KEYWORD) {
    return (
      "tx.execute() refuses any statement that uses U& (a Unicode-escaped identifier or string): " +
      "the escapes spell names without showing them, so the whole form is refused (ADR-0002)"
    );
  }
  if ((TEXT_EXECUTING_FUNCTIONS as readonly string[]).includes(keyword)) {
    return (
      `tx.execute() refuses any statement that mentions ${keyword}: it is a PostgreSQL function ` +
      "that runs SQL given as text, so the clinic could move with no forbidden word in the " +
      "statement at all (ADR-0002)"
    );
  }
  if ((SESSION_SCOPED_FUNCTIONS as readonly string[]).includes(keyword)) {
    return (
      `tx.execute() refuses any statement that mentions ${keyword}: its effect outlives the ` +
      "transaction or reaches another connection, which the wrapper can neither check nor roll " +
      "back — use the pg_advisory_xact_lock* variants for locks (ADR-0002)"
    );
  }
  if (keyword === MULTIPLE_STATEMENTS) {
    return (
      "tx.execute() refuses more than one statement in a single call: a parameterless query runs " +
      "on the simple protocol, where a second statement hides behind `;` and can commit the " +
      "transaction the wrapper owns (ADR-0002)"
    );
  }
  if (keyword === UNTERMINATED_COMMENT) {
    return (
      "tx.execute() refuses a statement with an unterminated block comment: PostgreSQL never ends " +
      "it, so the guard cannot tell what the statement really is (ADR-0002)"
    );
  }
  const kind =
    keyword === EMPTY_STATEMENT
      ? "a statement with no plain SQL keyword to read — nothing to check is not something fn may send"
      : `a statement that starts with ${keyword}`;
  return (
    `tx.execute() refuses ${kind}: that statement kind is not one fn may send — the wrapper owns ` +
    `the transaction boundary and the session settings, and the only kinds that go through are ` +
    `${ALLOWED_LIST} (ADR-0002)`
  );
}

/**
 * أول دالة من `TEXT_EXECUTING_FUNCTIONS` ظهرت في النص.
 *
 * @param text جملة الـ caller كما هي
 * @returns اسم الدالة أو `undefined`
 */
const textExecutingHit = (text: string): string | undefined =>
  TEXT_EXECUTING.find(([, pattern]) => pattern.test(text))?.[0];

/**
 * أول دالة من `SESSION_SCOPED_FUNCTIONS` ظهرت في النص.
 *
 * @param text جملة الـ caller كما هي
 * @returns اسم الدالة أو `undefined`
 */
const sessionScopedHit = (text: string): string | undefined =>
  SESSION_SCOPED.find(([, pattern]) => pattern.test(text))?.[0];

/**
 * الكلمة اللي تجعل الجملة ممنوعة، أو `undefined` لو الجملة عادية.
 *
 * الترتيب مقصود: فحص المحتوى على **النص الخام** الأول (مش محتاج body أصلاً)، بعدين نوع الجملة
 * من الـ body، وأخيراً الفاصل. فحص المحتوى قبل نوع الجملة معناه إن `set_config` جوه `DO` بتتسمّى
 * `set_config` — وده السبب الصح، مش الكلمة اللي بتلفّها.
 *
 * @param text جملة الـ caller كما هي (تعليقات وقوسات ماشية)
 * @returns الكلمة المانعة أو `undefined`
 */
export function forbiddenKeyword(text: string): string | undefined {
  if (UNICODE_ESCAPE.test(text)) return UNICODE_ESCAPE_KEYWORD;
  if (SET_CONFIG.test(text)) return "set_config";
  if (PG_SETTINGS.test(text)) return PG_SETTINGS_KEYWORD;
  const functionName = textExecutingHit(text);
  if (functionName !== undefined) return functionName;
  const sessionScoped = sessionScopedHit(text);
  if (sessionScoped !== undefined) return sessionScoped;
  const facts = lexStatement(text);
  if (facts.unterminatedComment) return UNTERMINATED_COMMENT;
  const word = facts.firstWord;
  if (word === undefined) return EMPTY_STATEMENT;
  if (!ALLOWED_FIRST_WORD.has(word.toUpperCase())) return word.toUpperCase();
  return facts.trailingStatement ? MULTIPLE_STATEMENTS : undefined;
}

/**
 * الحارس نفسه: بيرمي ولا بيرجّع.
 *
 * @param text جملة الـ caller كما هي
 * @throws ForbiddenStatementError لو الجملة banned
 */
export function assertStatementAllowed(text: string): void {
  const keyword = forbiddenKeyword(text);
  if (keyword !== undefined) throw new ForbiddenStatementError(keyword);
}
