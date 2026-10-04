import { TOKEN_PREFIX } from "./credential-words.ts";
import { REDACTED } from "./masks.ts";
import { opensQuote, valueEnd } from "./quotes.ts";
import { SEPARATOR_PATTERN } from "./separators.ts";

// Arabic credential labels written in free text: `كلمة المرور: hunter2`, `رمز التحقق 482193`. The English
// `name=value` scanner cannot see them — `\w` is ASCII-only in JavaScript — and an Arabic-first app writes
// exactly these labels in its own diagnostics. The vocabulary is a fixed list rather than "any non-ASCII
// name", which would wipe every Arabic `الحالة: نشط`.

// Harakat, shadda and tatweel are decoration, not spelling (`كلمـة`, `كَلِمَة`): after every Arabic letter of
// the vocabulary any number of them is allowed — every combining mark (`\p{M}`), not a hand-picked range, and
// no bound (a bound of three let four through). Still linear: a mark run is followed by a required letter,
// and it cannot start a label (the lookbehind rejects a preceding mark).
const MARKS = "[\\p{M}\\u0640]*";
const ARABIC_IN_WORD = /[ء-غف-ي]/;
// Spellings of the same letter: a final yeh written as alef maqsura or Persian yeh (`السرى`), and the
// Persian kaf (`کلمه`) some keyboards produce.
const VARIANTS: Readonly<Record<string, string>> = {
  ي: "[يىی]",
  ك: "[كک]",
};
// The vocabulary is built from plain words and letter sets, never parsed back out of a regex source.
const word = (text: string): string =>
  [...text]
    .map((char) => (ARABIC_IN_WORD.test(char) ? (VARIANTS[char] ?? char) + MARKS : char))
    .join("");
const oneOf = (letters: string): string => `[${letters}]${MARKS}`;
const any = (...words: string[]): string => `(?:${words.map(word).join("|")})`;

// Attached particles (و ف ب ل ك: `وبكلمة`, `فبالرمز`, `لرمز`) and the article (ال, or لل after ل). Unbounded,
// since any bound is a blind spot one particle past it, and still linear: inside a particle run every position
// is preceded by a letter, so the lookbehind rejects it at once — only the word's first letter starts a try.
const PREFIX = `(?:${oneOf("وفبلكک")})*${any("ال", "لل")}?`;
// The gap between the two words of a label: spaces, `_` or `-`. Unbounded, because a bound is a blind spot
// ("كلمة    المرور"); it stays linear because a required word follows it.
const GAP = `[\\s_-]*${any("ال")}?`;
const SECRET_ADJ = "سري";
const LABEL =
  `${PREFIX}(?:` +
  [
    `${word("كلم")}${oneOf("ةه")}${GAP}${any("مرور", "سر")}`,
    `${word("رقم")}${GAP}${word(SECRET_ADJ)}`,
    `${any("رمز", "كود")}(?:${GAP}${any("تحقق", "دخول", "تفعيل", "مرور", "أمان", "امان", SECRET_ADJ, "أمني", "امني", "otp")})?`,
    `${word("مفتاح")}(?:${GAP}${any("api", "واجهة", SECRET_ADJ, "خاص", "وصول")})?`,
    any("سر", "توكن", "باسورد", "باسوورد"),
  ].join("|") +
  ")";
// `:`/`=`, a dash, an arrow or a bar (the shared SEPARATOR_PATTERN), or `هي`/`هو` ("is"), makes it an
// assignment and the value is withheld whatever it is; a bare space — or a value glued to the label with
// digits (`الرمز123456`) — requires the value to look like a credential, so `كلمة المرور غير صحيحة` stays
// readable. A quoted key (`{"كلمة المرور":"x"}`) is read like the English one. The whitespace runs are
// unbounded (a bound let four spaces through) and stay linear: each is followed by a required token, so a
// failed label backtracks over its own run once. The lookahead only requires a value to start.
const ARABIC_CREDENTIAL = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_])(${LABEL})(?![\\p{L}\\p{M}_])` +
    `(\\\\?["']?\\s*(?:${SEPARATOR_PATTERN}|(?:هي|هو|هى)(?![\\p{L}\\p{M}]))\\s*|\\\\?["']?\\s+|(?=\\p{N}))` +
    `(?=[^\\s&,;،؛])`,
  "giu",
);
const ARABIC_LETTER = /[؀-ۿ]/;
// The separator group holds one of the explicit separators, or only quotes and spaces (a bare space).
const EXPLICIT = new RegExp(`${SEPARATOR_PATTERN}|ه[يوى]`, "u");

// After a bare space the first word must itself look like a secret: a digit (any script) or a token prefix.
// Length alone is not enough here — a long Arabic word (`الإلكترونيات`) is prose, not a credential.
// The whole first word is read (a 200-character bound let a later digit through), by one sticky scan that
// stops at the first digit — linear in the word, once per label.
const DIGIT_IN_FIRST_WORD = /[^\s&,;،؛\p{Nd}]*\p{Nd}/uy;
const looksLikeArabicLabelValue = (text: string, start: number): boolean => {
  if (TOKEN_PREFIX.test(text.slice(start, start + 4))) return true;
  DIGIT_IN_FIRST_WORD.lastIndex = start;
  return DIGIT_IN_FIRST_WORD.test(text);
};

/**
 * يخفي قيمة أي بيانات اعتماد مكتوبة بعد اسمها العربي داخل نص حر (كلمة المرور، الرقم السري، رمز التحقق…).
 *
 * @param text any already-normalised string value
 * @returns the text with each Arabic-labelled credential value replaced
 */
export function redactArabicCredentials(text: string): string {
  if (!ARABIC_LETTER.test(text)) return text;
  let out = "";
  let last = 0;
  ARABIC_CREDENTIAL.lastIndex = 0;
  for (
    let match = ARABIC_CREDENTIAL.exec(text);
    match !== null;
    match = ARABIC_CREDENTIAL.exec(text)
  ) {
    // The groups are guaranteed by the pattern; the defaults satisfy the checker.
    const label = match[1] ?? "";
    const separator = match[2] ?? "";
    const start = match.index + match[0].length;
    // A quoted value is a credential whatever its words are, as in English (`password 'a b c'`).
    if (
      !EXPLICIT.test(separator) &&
      !opensQuote(text, start) &&
      !looksLikeArabicLabelValue(text, start)
    ) {
      // Not a credential here; the next label may start right after this one.
      ARABIC_CREDENTIAL.lastIndex = match.index + label.length;
      continue;
    }
    const end = valueEnd(text, start);
    out += text.slice(last, start) + REDACTED;
    last = end;
    ARABIC_CREDENTIAL.lastIndex = end;
  }
  return out + text.slice(last);
}
