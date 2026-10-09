/** Minutes the zone is ahead of UTC at that instant (a zone with daylight saving moves). */
function offsetMinutes(at: Date, timeZone: string): number {
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
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
