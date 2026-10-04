import { isFreeTextCredentialName } from "./credential-words.ts";
import { REDACTED } from "./masks.ts";
import { valueEnd } from "./quotes.ts";

// The explicit separators between a credential name and its value, shared by the English and the Arabic
// free-text scanners so a value after `password -> x` and after `كلمة المرور ← x` is treated alike:
// `:`/`=` runs, ASCII arrows both ways, and runs of dashes (U+2010–U+2015 included), bars and the arrow
// characters (← → ⇐ ⇒). A run is at most three characters, so the pattern is constant-cost.

/** The separator alternatives as a regex source fragment (no group, no flags). */
export const SEPARATOR_PATTERN =
  "(?:[:=]{1,3}|->|=>|<-|<=|[\\-\\u2010-\\u2015|\\u2190\\u2192\\u21D0\\u21D2]{1,3})";

// A credential name followed by a dash, arrow or bar, with or without spaces (`password - x`,
// `password->x`, `token|x`). An ASCII `-` glued on BOTH sides is a word joiner, not a separator
// (`password-reset`), so it needs a space on at least one side; the other separators never join words.
// `:`/`=` are the assignment scanner's. The name is lazy, bounded and anchored like ASSIGNMENT's, and each
// whitespace run is followed by a required token, so the scan stays linear.
const SEPARATED_PAIR = new RegExp(
  // The name may be quoted (`"password" -> x`, `\"password\"->x`), as in ASSIGNMENT.
  "(?<![\\w.-])([\\w.-]{1,200}?)\\\\?[\"']?" +
    "(?:\\s*(?:->|=>|<-|<=|[|\\u2010-\\u2015\\u2190\\u2192\\u21D0\\u21D2]{1,3})\\s*|\\s+-{1,3}\\s*|-{1,3}\\s+)" +
    "(?=\\S)",
  "gu",
);

/**
 * يخفي القيمة بعد اسم بيانات اعتماد مفصول عنها بشَرطة أو سهم أو `|` (`password -> x`)، لحد نهاية الزوج
 * أو علامة التنصيص اللي بتقفلها.
 *
 * @param text any already-normalised string value
 * @returns the text with each such value replaced
 */
export function redactSeparatedPairs(text: string): string {
  let out = "";
  let last = 0;
  SEPARATED_PAIR.lastIndex = 0;
  for (let match = SEPARATED_PAIR.exec(text); match !== null; match = SEPARATED_PAIR.exec(text)) {
    // The group is guaranteed by the pattern; the default satisfies the checker.
    const name = match[1] ?? "";
    if (!isFreeTextCredentialName(name)) {
      // Not a credential; the next word may still be one.
      SEPARATED_PAIR.lastIndex = match.index + name.length;
      continue;
    }
    const start = match.index + match[0].length;
    const end = valueEnd(text, start);
    out += text.slice(last, start) + REDACTED;
    last = end;
    SEPARATED_PAIR.lastIndex = end;
  }
  return out + text.slice(last);
}
