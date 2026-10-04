/**
 * قارئ نصي صغير بيقلّد قواعد الـ lexer بتاع PostgreSQL على قدر ما حارس الـ statement محتاج.
 *
 * ليه ملف لوحده: الـ guard قرار (إيه المسموح)، واللي هنا **معلومات** عن النص. الفصل بيخلّي
 * `forbiddenKeyword` قائمة قرار واضحة من غير قارئ جواها، وبيجيب اختبار للنص وحده.
 *
 * القواعد اللي بتتقلّد بالظبط:
 *
 * - مسافة PostgreSQL هي `[ \t\n\r\f\v]` — مش `String.trim` ولا `\s` في JS: دول بيبلعوا كمان
 *   NBSP و`U+2028` و`U+FEFF`، وPostgreSQL ما بعتبرهاش مسافة. الزيادة دي fail-closed مش ثغرة
 *   (إحنا بنتجاهل أكتر من PostgreSQL)، بس عشان الحارس يبقى واثق: اللي بيعدّه مسافة هو مسافة
 *   PostgreSQL بالظبط، مش تخمين على `trim`.
 * - التعليق السطري `--` بيخلص عند `\n` **أو** `\r` (قاعدة `newline [\n\r]` في PostgreSQL).
 *   البحث عن `\n` وحده كان بيسيب `select set_config(...)` جوّه الجملة كأنها لسه comment.
 * - تعليقات `/* … *\/` بتتداخل في PostgreSQL، فالعدّ لازم يبقى عدّاد مش `indexOf`.
 * - تعليق مابيقفلش (مفيش `*\/`) بيبلع آخر الجملة كلها في نظر PostgreSQL — فالنص مش المفروض
 *   نقراه على أنه جملة واحدة، وبيترفض (fail closed) بدل ما نتعامل معاه كأنه مالوش لازمة.
 *
 * مفيش هنا أي تنفيذ ولا أي حالة: الحارس بياخد الحاجات دي ويقرر.
 */

/**
 * مسافات PostgreSQL في الـ lexer: حرف بحرف.
 */
const WHITESPACE: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

/**
 * @param character حرف واحد، أو `undefined` لو النص خلص
 * @returns true لو PostgreSQL يعتبره مسافة
 */
export const isWhitespace = (character: string | undefined): boolean =>
  character !== undefined && WHITESPACE.has(character);

/** النص كله مسافة (بمعنى PostgreSQL)؟ فاصلة جملة وجواها `&nbsp;` جملة تانية، فمفيش تسامح. */
const isOnlyWhitespace = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (!isWhitespace(text[index])) return false;
  }
  return true;
};

/**
 * أول `\n` أو `\r` من `from` — نهاية التعليق السطري.
 *
 * @param text النص
 * @param from موضع البداية
 * @returns موضع أول سطر جديد، أو -1
 */
const firstLineBreak = (text: string, from: number): number => {
  for (let index = from; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n" || character === "\r") return index;
  }
  return -1;
};

/**
 * بياخد الموضع اللي بعد أول تعليق `/* … *\/` متداخل.
 *
 * @param text النص
 * @param from موضع الـ `/*` الأول
 * @returns الموضع بعد الـ `*\/` المقفل، أو -1 لو التعليق مابيقفلش
 */
const afterBlockComment = (text: string, from: number): number => {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      depth += 1;
      index += 2;
      continue;
    }
    if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return -1;
};

/**
 * أول كلمة في الجملة: الكلمة كاملة (في `SETTLE` مش `SET`)، و ASCII بس.
 *
 * الـ ASCII بس عن قصد: كلمة تبدأ بحرف غير ASCII (`«SELECT`) مابتنفعش تكون اسم جملة منسدلة —
 * PostgreSQL فعلياً بيقراها معرّف مش keyword — فبتترفض كأن الحارس مش شايف حاجة. وده fail-closed:
 * الكلمة اللي الحارس مش عارفها ما بتبعتش أصلاً.
 *
 * @param body النص من أول كلمة فعلية
 * @returns الكلمة أو `undefined`
 */
const FIRST_WORD = /^[A-Za-z_][A-Za-z_$0-9]*/;

/** معلومات الجملة من النص — نصية بحتة، مفيش تنفيذ ولا حالة. */
export interface StatementFacts {
  /** النص من أول كلمة فعلية في الجملة (تعليقات ومسافات وأقواس ماشية). */
  readonly body: string;
  /** أول كلمة كاملة في الجملة، أو `undefined` لو مفيش كلمة. */
  readonly firstWord: string | undefined;
  /** فيه تعليق `/*` ما اتقفلش: النص مش قابل للقراءة كجملة واحدة. */
  readonly unterminatedComment: boolean;
  /** فيه `;` وراه حاجة غير مسافة: أكتر من statement في نداء واحد. */
  readonly trailingStatement: boolean;
}

/**
 * بيخلي كل اللي ممكن يسبق أول كلمة: مسافات، `--` لحد آخر سطر (أو `\r`)، `/* … *\/` متداخلة،
 * و`(` بتفتح جملة (القوس بيتقفل قبل `SELECT` فيبقى بينه وبين أول كلمة حقيقية).
 *
 * @param text النص كما أرسله الـ caller
 * @returns النص من أول كلمة فعلية
 */
const skipLeadingNoise = (text: string): string => {
  let index = 0;
  for (;;) {
    while (isWhitespace(text[index])) index += 1;
    if (text.startsWith("--", index)) {
      const lineBreak = firstLineBreak(text, index + 2);
      index = lineBreak === -1 ? text.length : lineBreak + 1;
      continue;
    }
    if (text.startsWith("/*", index)) {
      const after = afterBlockComment(text, index);
      index = after === -1 ? text.length : after;
      continue;
    }
    if (text[index] === "(") {
      index += 1;
      continue;
    }
    return text.slice(index);
  }
};

/**
 * فيه تعليق بلوكي ما اتقفلش في النص كله؟ العدّاد بيعدّ `/*` و`*\/` على النص الخام من غير ما
 * يفهم الأقواس ولا الـ dollar-quotes: `SELECT '/*'` جملة خربانة عند PostgreSQL (syntax error)
 * وأحنا بنرفضها بدل ما نعدّيها، ورفض جملة مستحيلة أصعب بكتير من رفض قيمة فيها `/*`.
 *
 * @param text النص كما أرسله الـ caller
 * @returns true لو فيه `/*` ما اتقفلش
 */
const hasUnterminatedComment = (text: string): boolean => {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("/*", index)) {
      depth += 1;
      index += 1;
    } else if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 1;
    }
  }
  return depth > 0;
};

/**
 * فيه فاصل جمل وراه محتوى؟ الفحص على **النص الخام** (مش على الـ body) عشان فاصلة جوه string
 * متسببش تعمية زي `SELECT '--'; COMMIT` — fail-closed بقصد.
 *
 * @param text جملة الـ caller كما هي
 * @returns true لو أول `;` وراه حاجة غير مسافة
 */
const hasTrailingStatement = (text: string): boolean => {
  const separator = text.indexOf(";");
  return separator !== -1 && !isOnlyWhitespace(text.slice(separator + 1));
};

/**
 * بيقرأ جملة الـ caller نصياً: الـ body بعد التعليقات، أول كلمة، التعليق المفتوح، والفاصل.
 *
 * الحارس بياخد الحاجات دي عشان يقرر، بس **مش** بيقرا حاجة من الـ body عشان يقرر (فحص
 * `set_config` بيتم على النص الخام — شوف `statement-guard.ts`).
 *
 * @param text جملة الـ caller كما هي
 * @returns معلومات الجملة
 */
export function lexStatement(text: string): StatementFacts {
  const body = skipLeadingNoise(text);
  return {
    body,
    firstWord: FIRST_WORD.exec(body)?.[0],
    unterminatedComment: hasUnterminatedComment(text),
    trailingStatement: hasTrailingStatement(text),
  };
}
