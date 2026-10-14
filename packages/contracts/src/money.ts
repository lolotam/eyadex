import { z } from "zod";

/**
 * The currencies a clinic can hold (finance spec R1-6) and their minor-unit exponent, which is derived from
 * the code and never typed: KWD has 1000 fils to the dinar, SAR has 100 halalas to the riyal.
 */
export const SUPPORTED_CURRENCIES = { KWD: 3, BHD: 3, OMR: 3, SAR: 2, AED: 2, QAR: 2 } as const;
export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;
export const currencyCodeSchema = z.enum(["KWD", "BHD", "OMR", "SAR", "AED", "QAR"]);

/** R1-2: the largest amount one invoice line may carry, in minor units. */
export const MAX_LINE_MINOR = 1_000_000_000_000n;

/**
 * R1-2: an amount in minor units on the wire is a canonical decimal integer string ("12500" = 12.500 KWD),
 * never a JSON number, so no value is ever rounded through a float.
 */
const MINOR_TEXT = /^(0|[1-9][0-9]{0,12})$/;

// One refine (not regex + refine): Zod runs every refine even after a failed regex, and BigInt("1.5") throws.
export const minorAmountSchema = z
  .string({ invalid_type_error: "validation.amount" })
  .refine((v) => MINOR_TEXT.test(v) && BigInt(v) <= MAX_LINE_MINOR, "validation.amount");

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
