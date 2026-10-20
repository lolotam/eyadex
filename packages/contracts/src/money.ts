import { z } from "zod";

/**
 * The currencies a clinic can hold (finance spec R1-6) and their minor-unit exponent, which is derived from
 * the code and never typed: KWD has 1000 fils to the dinar, SAR has 100 halalas to the riyal.
 */
export const SUPPORTED_CURRENCIES = { KWD: 3, BHD: 3, OMR: 3, SAR: 2, AED: 2, QAR: 2 } as const;
export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;
export const currencyCodeSchema = z.enum(["KWD", "BHD", "OMR", "SAR", "AED", "QAR"]);

/** R1-2: the largest amount one invoice line may carry (unit price × quantity), in minor units. */
export const MAX_LINE_MINOR = 1_000_000_000_000n;

/** R1-2: the PostgreSQL `bigint` ceiling — the bound of every aggregate (totals, invoice discount). */
export const MAX_MINOR = 9_223_372_036_854_775_807n;

/** R3-5: a negative drawer expectation or difference may reach PostgreSQL's bigint floor. */
export const MIN_MINOR = -9_223_372_036_854_775_808n;

/** A drawer's counted and expected amounts are bounded so counted − expected always fits `bigint` (PR #89 review; 0064 CHECKs the same bound). */
export const MAX_CASH_MINOR = 1_000_000_000_000_000_000n;

const MINOR_TEXT = /^(0|[1-9][0-9]{0,18})$/;

// One refine (not regex + refine): Zod runs every refine even after a failed regex, and BigInt("1.5") throws.
const minorUpTo = (max: bigint) =>
  z
    .string({ invalid_type_error: "validation.amount" })
    .refine((v) => MINOR_TEXT.test(v) && BigInt(v) <= max, "validation.amount");

/**
 * R1-2: an amount in minor units on the wire is a canonical decimal integer string ("12500" = 12.500 KWD),
 * never a JSON number, so no value is ever rounded through a float. This is the aggregate bound (totals,
 * invoice discounts, response amounts).
 */
export const minorAmountSchema = minorUpTo(MAX_MINOR);

/** Payments, refunds and credit applications move money, so zero is not a valid amount (R3-7). */
export const positiveMinorAmountSchema = minorAmountSchema.refine(
  (v) => v !== "0",
  "validation.amount",
);

/** R3-5: drawer expectations and differences may be negative, without rounding through a float. */
export const signedMinorAmountSchema = z
  .string({ invalid_type_error: "validation.amount" })
  .refine(
    (v) =>
      /^-?(0|[1-9][0-9]{0,18})$/.test(v) &&
      v !== "-0" &&
      BigInt(v) >= MIN_MINOR &&
      BigInt(v) <= MAX_MINOR,
    "validation.amount",
  );

/** A counted drawer amount, bounded so the difference against the expectation always fits a bigint. */
export const cashMinorAmountSchema = minorUpTo(MAX_CASH_MINOR);

/** A drawer's expected amount: it may be negative, within the same bound as the counted amount. */
export const signedCashMinorAmountSchema = z
  .string({ invalid_type_error: "validation.amount" })
  .refine(
    (v) =>
      /^-?(0|[1-9][0-9]{0,18})$/.test(v) &&
      v !== "-0" &&
      BigInt(v) >= -MAX_CASH_MINOR &&
      BigInt(v) <= MAX_CASH_MINOR,
    "validation.amount",
  );

/** The per-line bound: a unit price, a line discount amount, a service or per-doctor price. */
export const minorLineAmountSchema = minorUpTo(MAX_LINE_MINOR);

/**
 * Renders minor units with the currency's decimals, using string arithmetic only.
 *
 * @param minor a canonical minor-unit string
 * @param exponent the currency's minor-unit exponent
 * @returns the amount with exactly `exponent` decimals, e.g. "12.500"
 */
export function formatMinor(minor: string, exponent: number): string {
  if (exponent === 0) return minor;
  const padded = minor.padStart(exponent + 1, "0");
  return `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/**
 * Keeps a negative sign outside the padded absolute value, so a shortage of one fils is "-0.001".
 *
 * @param minor a canonical signed minor-unit string
 * @param exponent the currency's minor-unit exponent
 * @returns the signed amount with exactly `exponent` decimals
 */
export function formatSignedMinor(minor: string, exponent: number): string {
  return minor.startsWith("-")
    ? `-${formatMinor(minor.slice(1), exponent)}`
    : formatMinor(minor, exponent);
}

/**
 * Reads an amount typed in major units ("12.5") into minor units, refusing more decimals than the currency has.
 *
 * @param text what the user typed, with a dot as the decimal separator
 * @param exponent the currency's minor-unit exponent
 * @returns the canonical minor-unit string, or null when the text is not a valid amount
 */
export function parseMajorToMinor(text: string, exponent: number): string | null {
  const match = /^([0-9]+)(?:\.([0-9]*))?$/.exec(text.trim());
  if (match === null) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const minor = BigInt(match[1]! + fraction.padEnd(exponent, "0"));
  return minor.toString();
}
