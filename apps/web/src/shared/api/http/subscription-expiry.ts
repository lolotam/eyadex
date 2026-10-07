import type { SubscriptionInput } from "@eyadex/contracts/clinics";

/** Today's calendar date in a time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** N calendar months after a date; a day the target month lacks becomes its last day (31 Jan + 1 = 28/29 Feb). */
export function addCalendarMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Always an explicit instant, never `durationDays`: the same input on the same day gives the same
 * body, so a retried PATCH is idempotent without a key. The end of the day matches the date mode.
 */
export function explicitExpiry(
  input: Pick<SubscriptionInput, "expiryMode" | "expiresOn" | "durationMonths">,
  timeZone: string,
  now: Date,
): string {
  const date =
    input.expiryMode === "date"
      ? input.expiresOn
      : addCalendarMonths(todayIn(timeZone, now), input.durationMonths);
  return `${date}T23:59:59Z`;
}

/** Days after today, used for a new clinic's trial; same end-of-day rule. */
export function expiryAfterDays(days: number, now: Date): string {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return `${end.toISOString().slice(0, 10)}T23:59:59Z`;
}
