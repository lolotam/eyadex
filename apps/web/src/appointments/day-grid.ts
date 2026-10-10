import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { instantToWall, wallToInstant } from "@eyadex/contracts/clinic-time";

// Pure layout of the branch day (spec §5): every position is real minutes after the clinic's midnight of
// the shown date, so a block that started yesterday or ends tomorrow is clipped to the day, and on a
// daylight-saving day (23 or 25 hours) blocks, hours, labels and slots share one axis (Codex A2 r2, r3).

/** Pixels per minute: one hour is 120px, so a 20-minute visit still shows its patient and time. */
export const PX_PER_MINUTE = 2;
/** The bookable slot length offered by a click (the dialog edits it freely). */
export const SLOT_MINUTES = 30;
const DEFAULT_FROM = 8 * 60;
const DEFAULT_TO = 20 * 60;

const dayStartMs = (date: string, timeZone: string) =>
  Date.parse(wallToInstant(date, "00:00", timeZone));

/**
 * Minutes from the clinic's midnight of `date` to the instant (negative before, > 1440 after), counted on
 * the real clock: on a daylight-saving day a block keeps its order and length instead of folding into the
 * repeated hour and vanishing (Codex A2 r2).
 */
export function minuteOfDay(iso: string, date: string, timeZone: string): number {
  return Math.round((Date.parse(iso) - dayStartMs(date, timeZone)) / 60_000);
}

/** The day's real length in minutes (1440, or 1380 / 1500 on a daylight-saving day). */
export const dayLength = (date: string, timeZone: string) =>
  minuteOfDay(wallToInstant(shiftDate(date, 1), "00:00", timeZone), date, timeZone);

/** A schedule's wall time (`24:00` = the day's end) on the grid's axis. */
export function shiftMinute(date: string, time: string, timeZone: string): number {
  if (time === "24:00") return dayLength(date, timeZone);
  return minuteOfDay(wallToInstant(date, time, timeZone), date, timeZone);
}

/**
 * The instant at a minute of the axis. On a day the clock falls back, two minutes of the axis read the
 * same `HH:MM`; only the instant tells them apart (Codex PR #64).
 */
export function instantAt(minute: number, date: string, timeZone: string): string {
  return new Date(dayStartMs(date, timeZone) + minute * 60_000).toISOString();
}

/** The clinic's `HH:MM` at a minute of the axis. */
export function labelAt(minute: number, date: string, timeZone: string): string {
  return wallTime(instantAt(minute, date, timeZone), timeZone);
}

/** The hours the grid shows: 08:00–20:00 widened to every shift and appointment, whole hours. */
export function visibleRange(day: AppointmentDay): { from: number; to: number } {
  const length = dayLength(day.date, day.timezone);
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  const widen = (start: number, end: number) => {
    from = Math.min(from, Math.max(0, start));
    to = Math.max(to, Math.min(length, end));
  };
  for (const p of day.providers) {
    for (const s of p.shifts) {
      widen(
        shiftMinute(day.date, s.startsAt, day.timezone),
        shiftMinute(day.date, s.endsAt, day.timezone),
      );
    }
  }
  for (const a of day.appointments) {
    widen(
      minuteOfDay(a.startsAt, day.date, day.timezone),
      minuteOfDay(a.endsAt, day.date, day.timezone),
    );
  }
  return { from: Math.floor(from / 60) * 60, to: Math.min(length, Math.ceil(to / 60) * 60) };
}

/** The top offset and height (px) of [start, end) inside the visible range, clipped to it. */
export function placement(
  start: number,
  end: number,
  range: { from: number; to: number },
): { top: number; height: number } | null {
  const a = Math.max(start, range.from);
  const b = Math.min(end, range.to);
  if (b <= a) return null;
  return { top: (a - range.from) * PX_PER_MINUTE, height: (b - a) * PX_PER_MINUTE };
}

/** The slot starts (minutes) a click can book, every `SLOT_MINUTES` across the range. */
export function slotStarts(range: { from: number; to: number }): number[] {
  const out: number[] = [];
  for (let m = range.from; m + SLOT_MINUTES <= range.to; m += SLOT_MINUTES) out.push(m);
  return out;
}

/** The hour marks of the axis, labelled on the clinic's clock. */
export function hourMarks(
  range: { from: number; to: number },
  date: string,
  timeZone: string,
): { minute: number; label: string }[] {
  const out: { minute: number; label: string }[] = [];
  for (let m = range.from; m < range.to; m += 60) {
    out.push({ minute: m, label: labelAt(m, date, timeZone) });
  }
  return out;
}

/** `HH:MM` in the clinic's zone. */
export const wallTime = (iso: string, timeZone: string) => instantToWall(iso, timeZone).time;

/** The clinic-calendar date `days` after `date`. */
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Side-by-side lanes for blocks that share minutes (an overbooked appointment): each block gets a lane
 * and the lane count of its cluster, so none hides another.
 */
export function lanes<T extends { id: string; startsAt: string; endsAt: string }>(
  items: readonly T[],
): Map<string, { lane: number; of: number }> {
  const sorted = [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const out = new Map<string, { lane: number; of: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const close = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, of: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    if (start >= clusterEnd) close();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.push(end) - 1;
    else laneEnds[lane] = end;
    cluster.push({ id: item.id, lane });
    clusterEnd = Math.max(clusterEnd === -Infinity ? end : clusterEnd, end);
  }
  close();
  return out;
}
