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

/** Minutes the zone is ahead of UTC at that instant (Cairo moves with daylight saving). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((local - at.getTime()) / 60_000);
}

/** 23:59:59 of a calendar date in a time zone, as a UTC instant. */
export function endOfLocalDay(date: string, timeZone: string): string {
  const asUtc = new Date(`${date}T23:59:59Z`);
  const instant = new Date(asUtc.getTime() - zoneOffsetMinutes(asUtc, timeZone) * 60_000);
  return instant.toISOString().replace(".000Z", "Z");
}

/** N calendar days after a date. */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A new clinic's trial: N days after the clinic's own today, to the end of that local day. */
export function trialExpiry(days: number, timeZone: string, now: Date): string {
  return endOfLocalDay(addCalendarDays(todayIn(timeZone, now), days), timeZone);
}
