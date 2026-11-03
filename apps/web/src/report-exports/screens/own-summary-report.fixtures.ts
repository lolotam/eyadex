// Synthetic R10 answers: months and amounts only, nothing resembles real data.
import type { OwnSummaryResponse } from "./own-summary-columns";

export const R10_KEYS = ["view:report_own:own", "view:invoices:own"];

/** Two months above 2^53 minor units each, so a Number() sum would lose digits. */
export const BIG_ROWS = [
  { period: "2026-09", billedMinor: "9007199254740993", currency: "KWD" as const },
  { period: "2026-10", billedMinor: "9007199254740995", currency: "KWD" as const },
];
export const BIG_SUM = "18014398509481988";

export function ownAnswer(
  rows: OwnSummaryResponse["rows"],
  billedMinor: string,
): OwnSummaryResponse {
  return { rows, totals: { billedMinor }, currency: "KWD", currencyExponent: 3 };
}
