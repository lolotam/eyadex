/**
 * حارس الـ statement: `fn` بتنفّذ SQL مربوط، والكلام ده بيفحص **قبل** ما الجملة تتبعت.
 *
 * ليه الفحص قبل الإرسال مقطوع Sound: الـ extended protocol في PostgreSQL بينفّذ **جملة واحدة
 * بالضبط** في كل نداء (`Parse`/`Bind`/`Execute`)، فمفيش `COMMIT` تاني ورا `COMMIT` أول في نفس
 * الـ call. يعني لو الجملة **بتبدأ** بكلمة بتفتح/بتقفل الـ transaction أو بغيّر الجلسة كلها،
 * دي جملة واحدة بتعملها لوحدها — والكلمة الأولى كفاية تحكم عليها.
 *
 * والكلمة اللي مش موجودة في القائمة دي (`set_config`) ليها معنى تاني خالص: هي الدالة الوحيدة
 * اللي تقدر تغيّر `app.clinic_id` أو الـ timeouts من **جوه** جملة عادية زي `SELECT`. فأي جملة
 * فيها الكلمة دي مرفوضة، مهما كانت بتعمل إيه.
 *
 * وليه بنرفض كمان **أي `;` وراه محتوى**: الـ extended protocol فعلًا بينفّذ جملة واحدة في الـ
 * Parse، بس postgres.js ما بيختارش الـ extended لما الجملة **من غير parameters** — بيسيب
 * `simple: args.length === 0` (شوف `postgres/src/index.js`)، والـ simple protocol بيقبل جمل
 * متعدّدة في نداء واحد. ساعتها `SELECT 1; COMMIT` بيعدّي من فحص الكلمة الأولى وينفّذ الاتنين
 * (`FunctionScan` بيـ commit نص الشغل). فالحارس بيرفض نص فيه فاصل جمل (`;`) وراه حاجة غير
 * مسافات — fail-closed: فاصلة جوه literal بتترفض كمان، ودي تكلفتها أقل بكتير من ثغرة commit.
 * الـ `;` الأخيرة لوحدها (زي `SELECT 1;`) مسموحة.
 *
 * الفحص fail-closed: نص بيسبق كلمة مسموحة (زي قيمة بين `'...'` فيها `set_config`) بيترفض كمان.
 * الـ cost إن query شرعية واحدة ترفضها وتتعامل معاها في الكود، والبديل إن عقد الـ wrapper يبقى
 * قابل للخرق بكلمة.
 *
 * الـ statements بتوع الـ wrapper نفسه — فتح الجلسة وإغلاقها — **مش** بيعدّوا على الحارس دول:
 * هما اللي بيحطّوا `set_config` وبيقراوا `app.clinic_id`، ومفيش معنى refuses-own-session-check.
 * بيمشوا على الـ transaction الحقيقية من جوه الباكاج (شوف `session-check.ts`)، واللي بياخدهم
 * `fn` هو `Tx` المحمي بس.
 */

/** الكلمات اللي بتفتح/بتقفل transaction أو بتغيّر الجلسة كلها — أول كلمة في الجملة = رفض. */
const CONTROL_KEYWORDS: ReadonlySet<string> = new Set([
  "BEGIN",
  "START",
  "COMMIT",
  "END",
  "ROLLBACK",
  "ABORT",
  "SAVEPOINT",
  "RELEASE",
  "PREPARE",
  "SET",
  "RESET",
  "DISCARD",
  "DO",
  "CALL",
  "LOCK",
  "LISTEN",
  "UNLISTEN",
  "LOAD",
  "COPY",
]);

/** الدالة اللي هي الطريق الوحيد لتغيير العيادة أو السقوف من جوه جملة عادية. */
const SET_CONFIG = /set_config/i;

/** كلمة تقرير لرفض أكتر من statement في نداء واحد — postgres.js بيستخدم الـ simple protocol وقتها. */
export const MULTIPLE_STATEMENTS = "multiple statements";

/** أول كلمة في الجملة — الكلمة كاملة، فـ `SETTLE` مش `SET`. */
const FIRST_WORD = /^[A-Za-z_][A-Za-z_0-9$]*/;

/**
 * بيقول لو النص فيه أكتر من statement: أول `;` وراه أي حاجة غير مسافات. الفحص على النص الخام
 * (مش على الجسم المنزوع) عشان فاصلة جوه string متسبّبش تعمية (`SELECT '--'; COMMIT`) — fail-closed
 * بقصد.
 *
 * @param text جملة الـ caller كما هي
 * @returns true لو فيه فاصل جمل وراه محتوى
 */
const hasSecondStatement = (text: string): boolean => {
  const separator = text.indexOf(";");
  return separator !== -1 && text.slice(separator + 1).trim() !== "";
};

/**
 * بيرجّع النص اللي بعد أول `/* … *\/` متداخل. PostgreSQL بيقبل التعليقات المتداخلة، فلازم
 * العدّاد يبقى عداد مش `indexOf`. تعليق مش مقفول = جملة غلط من وجهة PostgreSQL، فمفيش نص
 * فاضل نStripه.
 *
 * @param text النص من أول slash
 * @returns النص بعد التعليق، أو نص فاضي لو التعليق مش مقفول
 */
const afterBlockComment = (text: string): string => {
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      depth += 1;
      index += 2;
      continue;
    }
    if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return text.slice(index);
      continue;
    }
    index += 1;
  }
  return "";
};

/**
 * بيشيل كل اللي ممكن يسبق الكلمة الأولى: مسافات، `--` لحد آخر سطر، `/* … *\/` متداخلة،
 * و`(` بتفتح جملة (القوس بيتقفل قبل `SELECT`، فبيبقى بين كلمة الجملة وبين أول كلمة حقيقية).
 *
 * @param text جملة الـ caller كما هي
 * @returns النص من أول كلمة فعلية في الجملة
 */
const stripLeadingNoise = (text: string): string => {
  let rest = text;
  for (;;) {
    const before = rest;
    rest = rest.replace(/^\s+/, "");
    if (rest.startsWith("--")) {
      const newline = rest.indexOf("\n");
      rest = newline === -1 ? "" : rest.slice(newline + 1);
    } else if (rest.startsWith("/*")) {
      rest = afterBlockComment(rest);
    }
    while (rest.startsWith("(")) rest = rest.slice(1).replace(/^\s+/, "");
    if (rest === before) return rest;
  }
};

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
    super(
      keyword === "set_config"
        ? "tx.execute() refuses any statement that mentions set_config: it is the only way a " +
            "statement can re-point the clinic or a timeout, and the wrapper owns both (ADR-0002)"
        : keyword === MULTIPLE_STATEMENTS
          ? "tx.execute() refuses more than one statement in a single call: a parameterless query " +
            "runs on the simple protocol, where a second statement hides behind `;` and can commit " +
            "the wrapper's transaction (ADR-0002)"
          : `tx.execute() refuses ${keyword}: the wrapper owns the transaction boundary and the ` +
            "session settings, and one call runs exactly one statement (ADR-0002)",
    );
    this.keyword = keyword;
  }
}

/**
 * الكلمة اللي تجعل الجملة ممنوعة، أو `undefined` لو الجملة عادية.
 *
 * @param text جملة الـ caller كما هي (تعليقات وقوسات ماشية)
 * @returns الكلمة المانعة أو `undefined`
 */
export function forbiddenKeyword(text: string): string | undefined {
  const body = stripLeadingNoise(text);
  const word = FIRST_WORD.exec(body)?.[0];
  if (word !== undefined) {
    const keyword = word.toUpperCase();
    if (CONTROL_KEYWORDS.has(keyword)) return keyword;
  }
  if (SET_CONFIG.test(body)) return "set_config";
  return hasSecondStatement(text) ? MULTIPLE_STATEMENTS : undefined;
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
