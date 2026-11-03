import type { Language } from "@eyadex/contracts/common";
import { formatMinor } from "@eyadex/contracts/money";

export const reportLocale = (lang: Language) => (lang === "ar" ? "ar-KW" : "en-GB");

/**
 * A signed minor-unit string in the given exponent, with the language's own digits and grouping.
 * The value never passes through `Number`: the whole part is a BigInt and the decimals are digits.
 */
export function formatReportMinor(minor: string, exponent: number, lang: Language): string {
  const negative = minor.startsWith("-");
  const plain = formatMinor(negative ? minor.slice(1) : minor, exponent);
  const [whole = "0", fraction = ""] = plain.split(".");
  const numbers = new Intl.NumberFormat(reportLocale(lang), { useGrouping: true });
  const decimal = numbers.formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";
  const digits = [...fraction].map((digit) => numbers.format(Number(digit))).join("");
  const body = numbers.format(BigInt(whole)) + (fraction ? `${decimal}${digits}` : "");
  return negative ? `-${body}` : body;
}

/** The BigInt sum of minor-unit strings, for totals checks. */
export const sumMinor = (values: readonly string[]): string =>
  values.reduce((total, value) => total + BigInt(value), 0n).toString();

/**
 * The response's own total when it equals the BigInt sum of the rows on screen, otherwise null: a
 * total that disagrees with its rows is never displayed. Both sides are canonical minor-unit strings.
 */
export const agreedTotal = (values: readonly string[], total: string): string | null =>
  sumMinor(values) === total ? total : null;
