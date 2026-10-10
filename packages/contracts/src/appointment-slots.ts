import { instantToWall } from "./clinic-time.ts";
import { coversWallInterval, wallMinutes, type WallShift } from "./schedules.ts";
import { DURATION_MAX_MINUTES, DURATION_MIN_MINUTES } from "./services.ts";

// Slice A2's pure time rules (docs/specs/appointments-design.md §4, ADR-0026): rule 2's checks, rule 4's
// end and D-15's length. Shared by the API and the web mock, so both decide identically.

/** Whole minutes from one instant to another. */
export const minutesBetween = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / 60_000;

/** D-15: every appointment lasts 5 minutes to 8 hours. */
export const isAppointmentLength = (from: string, to: string): boolean => {
  const minutes = minutesBetween(from, to);
  return minutes >= DURATION_MIN_MINUTES && minutes <= DURATION_MAX_MINUTES;
};

/** Rule 2's checks, in the order they are decided; `overbook` lifts exactly these. */
export type SlotProblem = "outside_schedule" | "provider_time_off" | "appointment_overlap";

export interface TimeSpan {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Do two half-open spans share a minute? Touching ends do not. */
export const spansOverlap = (a: TimeSpan, b: TimeSpan): boolean =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/**
 * Rule 4: the end the client sent, else the service's duration, else the provider's default (D-2).
 *
 * @returns the end instant (ISO, UTC)
 */
export function resolveAppointmentEnd(
  startsAt: string,
  endsAt: string | null,
  serviceMinutes: number | null,
  providerDefaultMinutes: number,
): string {
  if (endsAt !== null) return new Date(endsAt).toISOString();
  const minutes = serviceMinutes ?? providerDefaultMinutes;
  return new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
}

/** A wall instant as its weekday and minute after midnight. */
function wallPoint(iso: string, timezone: string): { weekday: number; minute: number } {
  const wall = instantToWall(iso, timezone);
  return {
    weekday: new Date(`${wall.date}T00:00:00Z`).getUTCDay(),
    minute: wallMinutes(wall.time),
  };
}

/** Minutes the clinic's wall clock is ahead of UTC at an instant. */
function offsetAt(ms: number, timezone: string): number {
  const wall = instantToWall(new Date(ms).toISOString(), timezone);
  return Math.round(
    (Date.parse(`${wall.date}T${wall.time}:00Z`) - Math.floor(ms / 60_000) * 60_000) / 60_000,
  );
}

/**
 * The slot cut where the clinic's UTC offset changes (a daylight-saving jump or repeated hour; at most one
 * inside 8 hours), so each piece runs on the wall clock without a break.
 */
function wallPieces(slot: TimeSpan, timezone: string): TimeSpan[] {
  const from = Date.parse(slot.startsAt);
  const to = Date.parse(slot.endsAt);
  const offset = offsetAt(from, timezone);
  if (offsetAt(to - 60_000, timezone) === offset) return [slot];
  // The first minute on the new offset, by halving whole minutes.
  let lo = from;
  let hi = to - 60_000;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (offsetAt(mid, timezone) === offset) lo = mid;
    else hi = mid;
  }
  const cut = new Date(hi).toISOString();
  return [
    { startsAt: slot.startsAt, endsAt: cut },
    { startsAt: cut, endsAt: slot.endsAt },
  ];
}

/**
 * D-6, D-14: is the slot inside the provider's continuous working time? Each piece the wall clock runs
 * through without a break must lie in one continuous shift; on a normal day that is the whole slot, and
 * across a daylight-saving change it is exactly the wall minutes the slot touches (Codex A2 r1, r3).
 */
export function slotCovered(
  slot: TimeSpan,
  timezone: string,
  branchShifts: readonly WallShift[],
): boolean {
  return wallPieces(slot, timezone).every((piece) =>
    coversWallInterval(
      branchShifts,
      wallPoint(piece.startsAt, timezone),
      Math.round(minutesBetween(piece.startsAt, piece.endsAt)),
    ),
  );
}

/**
 * Rule 2 (D-6, D-14, D-3) in its fixed order: inside one continuous shift of THIS branch's rows, no time
 * off, no other live appointment of the provider (every branch: one person, one place).
 *
 * @param slot the wanted interval
 * @param timezone the clinic's zone (schedules are wall time)
 * @param branchShifts the provider's rows in the booking branch only
 * @param timeOff the provider's periods that are not cancelled
 * @param others the provider's other appointments that are not cancelled
 * @returns the failed checks, in order; `[]` = free
 */
export function appointmentSlotProblems(
  slot: TimeSpan,
  timezone: string,
  branchShifts: readonly WallShift[],
  timeOff: readonly TimeSpan[],
  others: readonly TimeSpan[],
): SlotProblem[] {
  const problems: SlotProblem[] = [];
  if (!slotCovered(slot, timezone, branchShifts)) problems.push("outside_schedule");
  if (timeOff.some((t) => spansOverlap(slot, t))) problems.push("provider_time_off");
  if (others.some((o) => spansOverlap(slot, o))) problems.push("appointment_overlap");
  return problems;
}
