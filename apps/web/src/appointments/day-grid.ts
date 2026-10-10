import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { instantToWall, wallToInstant } from "@eyadex/contracts/clinic-time";
import { minutesToWall, wallMinutes } from "@eyadex/contracts/schedules";

// Pure layout of the branch day (spec §5): every position is minutes after the clinic's midnight of
// the shown date, so a block that started yesterday or ends tomorrow is clipped to the day.

/** Pixels per minute: one hour is 64px. */
export const PX_PER_MINUTE = 64 / 60;
/** The bookable slot length offered by a click (the dialog edits it freely). */
export const SLOT_MINUTES = 30;
const DEFAULT_FROM = 8 * 60;
const DEFAULT_TO = 20 * 60;

const dayStartMs = (date: string, timeZone: string) =>
  Date.parse(wallToInstant(date, "00:00", timeZone));

/** Minutes from the clinic's midnight of `date` to the instant (negative before, > 1440 after). */
export function minuteOfDay(iso: string, date: string, timeZone: string): number {
  const wall = instantToWall(iso, timeZone);
  if (wall.date === date) return wallMinutes(wall.time);
  return Math.round((Date.parse(iso) - dayStartMs(date, timeZone)) / 60_000);
}

/** The hours the grid shows: 08:00–20:00 widened to every shift and appointment, whole hours. */
export function visibleRange(day: AppointmentDay): { from: number; to: number } {
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  const widen = (start: number, end: number) => {
    from = Math.min(from, Math.max(0, start));
    to = Math.max(to, Math.min(24 * 60, end));
  };
  for (const p of day.providers) {
    for (const s of p.shifts) widen(wallMinutes(s.startsAt), wallMinutes(s.endsAt));
  }
  for (const a of day.appointments) {
    widen(
      minuteOfDay(a.startsAt, day.date, day.timezone),
      minuteOfDay(a.endsAt, day.date, day.timezone),
    );
  }
  return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
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

/** The hour labels of the axis. */
export function hourMarks(range: {
  from: number;
  to: number;
}): { minute: number; label: string }[] {
  const out: { minute: number; label: string }[] = [];
  for (let m = range.from; m < range.to; m += 60) out.push({ minute: m, label: minutesToWall(m) });
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
