import type { AppointmentWeek } from "@eyadex/contracts/appointment-calendar";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { clinicDayBounds } from "@eyadex/contracts/clinic-time";
import { shiftDate } from "./day-grid";

// Pure calendar arithmetic for the week and month views (slice A4). Dates are clinic-calendar
// `YYYY-MM-DD` strings; weeks start on Sunday (Kuwait), as the spec's plan fixes.

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The Sunday on or before `date`. */
export const weekStartOf = (date: string) => shiftDate(date, -weekday(date));

/** `YYYY-MM` of a date. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The month `months` after `month` (`YYYY-MM`). */
export function shiftMonth(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

/** The Sunday-first grid of a month: leading blanks (null), then every date, padded to whole weeks. */
export function monthCells(month: string): (string | null)[] {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: weekday(first) }, () => null);
  for (let i = 0; i < length; i++) cells.push(shiftDate(first, i));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * One day of the provider week shaped as a branch day with one column, so the day's grid, blocks and
 * booking dialog are reused unchanged.
 */
export function weekDayAsDay(week: AppointmentWeek, index: number): AppointmentDay {
  const day = week.days[index]!;
  const span = clinicDayBounds(day.date, week.timezone);
  const inDay = (a: { startsAt: string; endsAt: string }) =>
    Date.parse(a.startsAt) < Date.parse(span.endsAt) &&
    Date.parse(a.endsAt) > Date.parse(span.startsAt);
  return {
    branch: week.branch,
    date: day.date,
    timezone: week.timezone,
    providers: [{ ...week.provider, shifts: day.shifts, timeOff: day.timeOff }],
    appointments: week.appointments.filter(inDay),
    can: week.can,
  };
}

/** The weekday keys, Sunday first, as the grids show them. */
export const WEEKDAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
/** The month keys, January first. */
export const MONTH_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
