// One formatter per zone and shape: building an `Intl.DateTimeFormat` costs far more than using it, and
// the day bounds below read the clock about a dozen times per date.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: "en-US" | "en-CA", timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}`;
  let found = formatters.get(key);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(locale, {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(locale === "en-US" ? { second: "2-digit" as const } : {}),
    });
    formatters.set(key, found);
  }
  return found;
}

/** Minutes the zone is ahead of UTC at that instant (a zone with daylight saving moves). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = formatter("en-US", timeZone).formatToParts(at);
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

/**
 * The UTC instant of a wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) in a clinic's zone. Two passes,
 * as `trialEndsAt` and `endOfLocalDay`: the first guess can fall on the other side of a DST change.
 */
export function wallToInstant(date: string, time: string, timeZone: string): string {
  const target = Date.parse(`${date}T${time}:00Z`);
  const guess = new Date(target - offsetMinutes(new Date(target), timeZone) * 60_000);
  return new Date(target - offsetMinutes(guess, timeZone) * 60_000).toISOString();
}

/** The wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) of an instant in a clinic's zone. */
export function instantToWall(iso: string, timeZone: string): { date: string; time: string } {
  const parts = formatter("en-CA", timeZone).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/**
 * Does the wall-clock date and time exist in the zone? A clock moved forward skips an hour, and
 * `wallToInstant` would quietly move such a time; a form refuses it instead.
 */
export function wallTimeExists(date: string, time: string, timeZone: string): boolean {
  const back = instantToWall(wallToInstant(date, time, timeZone), timeZone);
  return back.date === date && back.time === time;
}

const HOUR_MS = 3_600_000;

/** The calendar date after `date` (`YYYY-MM-DD`). */
const dateAfter = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);

/**
 * The first real instant whose clinic wall date is `date`: its midnight; the earlier reading when the
 * clock repeats midnight; the clock change itself when the clock skips midnight. On such a day
 * `wallToInstant(date, "00:00")` can land in the evening before (ADR-0026 A3).
 */
function firstInstantOf(date: string, timeZone: string): number {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  // Every offset the zone uses within a day and a half: a reading of 00:00 lies within 14 hours of the
  // UTC midnight, and a clock change stays in force far longer than the 6-hour step.
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    offsets.add(offsetMinutes(new Date(midnight + h * HOUR_MS), timeZone));
  }
  const wallAt = (ms: number) => instantToWall(new Date(ms).toISOString(), timeZone);
  const readings = [...offsets]
    .map((offset) => midnight - offset * 60_000)
    .filter((ms) => {
      const wall = wallAt(ms);
      return wall.date === date && wall.time === "00:00";
    });
  if (readings.length > 0) return Math.min(...readings);
  // Midnight skipped: before the change the clock reads the day before, after it this date. Halve whole
  // minutes between the reading under the largest offset (before) and under the smallest (after).
  let lo = midnight - Math.max(...offsets) * 60_000;
  let hi = midnight - Math.min(...offsets) * 60_000;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (wallAt(mid).date >= date) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * A clinic-calendar day as instants (rule 11): from the first real instant of `date` to the first of the
 * next date, in the clinic's zone. 1440 minutes, or 1380 / 1500 on a daylight-saving day, also when the
 * change skips or repeats midnight.
 *
 * @param date the clinic-calendar date (`YYYY-MM-DD`)
 * @param timeZone the clinic's IANA zone
 * @returns the day's start and end (ISO, UTC); the end is the next day's start
 */
export function clinicDayBounds(
  date: string,
  timeZone: string,
): { startsAt: string; endsAt: string } {
  return {
    startsAt: new Date(firstInstantOf(date, timeZone)).toISOString(),
    endsAt: new Date(firstInstantOf(dateAfter(date), timeZone)).toISOString(),
  };
}
