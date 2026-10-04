// Where a credential VALUE ends, shared by the English and the Arabic free-text scanners so a quoted value is
// withheld whole whichever label introduced it. A value ends at the closing quote when it opens with one —
// ASCII, escaped (JSON inside a JSON string) or typographic — and otherwise at the next pair delimiter.

// The pair delimiters: `&`, `,`, `;`, a line end, and the Arabic comma and semicolon.
const PAIR_END = /[&,;\r\n،؛]/g;

// Typographic opening quotes and the closings each accepts (`„` closes as `“` in German and `”` in Polish).
const TYPOGRAPHIC: Readonly<Record<string, string>> = {
  "“": "”",
  "‘": "’",
  "«": "»",
  "‹": "›",
  "„": "“”",
  "‚": "‘’",
  "「": "」",
  "『": "』",
};

// The backtick is a quote too: logs and markdown wrap values in it (`password: `a, b``).
const isAsciiQuote = (char: string | undefined): boolean =>
  char === "'" || char === '"' || char === "`";
const closingsOf = (char: string | undefined): string | undefined =>
  char !== undefined && Object.hasOwn(TYPOGRAPHIC, char) ? TYPOGRAPHIC[char] : undefined;

// An ASCII-quoted value closes on the first quote that is not itself escaped: behind an even number of
// backslashes (`"ab\"cd"` runs to the last quote). A value opened by `\"` closes only on `\"` — never on a
// bare quote — and skips `\\\"`, its own escaped quote. Unclosed: to the end. One pass, so linear.
const asciiQuotedEnd = (text: string, open: number, escaped: boolean): number => {
  const quote = text[open];
  let backslashes = 0;
  for (let i = open + 1; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === quote && (escaped ? backslashes === 1 : backslashes % 2 === 0)) return i + 1;
    backslashes = 0;
  }
  return text.length;
};

// A typographic value closes on the first of its closing marks (no escapes exist for them). Unclosed: to the
// end — failing closed, since an unclosed quote is exactly where a value with a comma inside would leak.
const typographicEnd = (text: string, open: number, closings: string): number => {
  for (let i = open + 1; i < text.length; i++) {
    if (closings.includes(text[i] ?? "")) return i + 1;
  }
  return text.length;
};

/**
 * Whether the value starting at `start` opens with a quote (ASCII, escaped ASCII or typographic).
 *
 * @param text the whole string
 * @param start where the value starts
 * @returns true when the value is quoted
 */
export const opensQuote = (text: string, start: number): boolean =>
  isAsciiQuote(text[start]) ||
  closingsOf(text[start]) !== undefined ||
  (text[start] === "\\" && isAsciiQuote(text[start + 1]));

/**
 * Where the credential value starting at `start` ends: after its closing quote when it is quoted, otherwise
 * at the next pair delimiter (or the end of the text).
 *
 * @param text the whole string
 * @param start where the value starts
 * @returns the index just past the value
 */
export function valueEnd(text: string, start: number): number {
  if (isAsciiQuote(text[start])) return asciiQuotedEnd(text, start, false);
  if (text[start] === "\\" && isAsciiQuote(text[start + 1])) {
    return asciiQuotedEnd(text, start + 1, true);
  }
  const closings = closingsOf(text[start]);
  if (closings !== undefined) return typographicEnd(text, start, closings);
  PAIR_END.lastIndex = start;
  return PAIR_END.exec(text)?.index ?? text.length;
}
