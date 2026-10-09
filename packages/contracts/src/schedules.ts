import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";

/** 0 = Sunday … 6 = Saturday (`Date.getDay`); the clinic's week starts on Sunday. */
export const weekdaySchema = z.number().int().min(0).max(6);
export const MINUTES_PER_DAY = 1440;
export const WEEK_MINUTES = 7 * MINUTES_PER_DAY;

const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Minutes after the clinic's midnight for `HH:MM` or `HH:MM:SS` (`24:00` = 1440). */
export function wallMinutes(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** `HH:MM` for minutes after midnight (1440 = `24:00`). */
export function minutesToWall(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One weekly row in clinic wall-clock time (D-6); it never crosses midnight on its own (D-14). */
export const shiftSchema = z
  .object({
    weekday: weekdaySchema,
    startsAt: z.string().regex(START, "validation.time"),
    endsAt: z.string().regex(END, "validation.time"),
  })
  .strict()
  .refine((s) => wallMinutes(s.startsAt) < wallMinutes(s.endsAt), {
    message: "validation.timeOrder",
    path: ["endsAt"],
  });
export type Shift = z.infer<typeof shiftSchema>;
export type WallShift = Pick<Shift, "weekday" | "startsAt" | "endsAt">;

/** `PUT /v1/schedules/:membershipId/branches/:branchId`: the provider's whole week in that branch. */
export const branchScheduleInputSchema = z
  .object({ shifts: z.array(shiftSchema).max(42) })
  .strict();
export type BranchScheduleInput = z.infer<typeof branchScheduleInputSchema>;

export const scheduleShiftSchema = z
  .object({ branchId: idSchema, weekday: weekdaySchema, startsAt: z.string(), endsAt: z.string() })
  .strict();
export type ScheduleShift = z.infer<typeof scheduleShiftSchema>;

/** A bookable member (D-1): active, "accepts appointments" on. */
export const providerSummarySchema = z
  .object({
    membershipId: idSchema,
    fullName: z.string(),
    defaultDurationMinutes: z.number().int(),
    allBranches: z.boolean(),
    branchIds: z.array(idSchema),
  })
  .strict();
export type ProviderSummary = z.infer<typeof providerSummarySchema>;

export const providerListResponseSchema = z
  .object({ items: z.array(providerSummarySchema) })
  .strict();
export type ProviderListResponse = z.infer<typeof providerListResponseSchema>;

export const scheduleBranchSchema = z
  .object({ id: idSchema, nameAr: z.string(), nameEn: z.string(), isActive: z.boolean() })
  .strict();
export type ScheduleBranch = z.infer<typeof scheduleBranchSchema>;

export const timeOffSchema = z
  .object({
    id: idSchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    note: z.string().nullable(),
  })
  .strict();
export type TimeOff = z.infer<typeof timeOffSchema>;

const note = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().max(200, "validation.tooLong"));

/** D-6: a period the provider cannot be booked in (instants with an offset; stored UTC). */
export const timeOffInputSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    note: note.nullable(),
  })
  .strict()
  .refine((v) => Date.parse(v.startsAt) < Date.parse(v.endsAt), {
    message: "validation.timeOrder",
    path: ["endsAt"],
  });
export type TimeOffInput = z.input<typeof timeOffInputSchema>;

/**
 * One provider's schedule as the caller may see it: the active branches it works in inside the
 * caller's reach (`branches`, editable), the branches inside the reach that still hold its rows
 * although it no longer works there or they are inactive (`dormantBranches`: read-only, can only be
 * cleared), its weekly rows in both (`shifts`), and its time off that has not ended. Dormant rows are
 * never working hours; they count only for the no-overlap rule (ADR-0026 §4).
 */
export const providerScheduleSchema = z
  .object({
    provider: providerSummarySchema,
    branches: z.array(scheduleBranchSchema),
    dormantBranches: z.array(scheduleBranchSchema),
    shifts: z.array(scheduleShiftSchema),
    timeOff: z.array(timeOffSchema),
  })
  .strict();
export type ProviderSchedule = z.infer<typeof providerScheduleSchema>;

type Span = { start: number; end: number };

const spanOf = (s: WallShift): Span => ({
  start: s.weekday * MINUTES_PER_DAY + wallMinutes(s.startsAt),
  end: s.weekday * MINUTES_PER_DAY + wallMinutes(s.endsAt),
});

/**
 * The first two rows that share a minute (touching ends do not), or null. A provider is in one place
 * at a time, so the caller passes the rows of every branch.
 */
export function findShiftOverlap<S extends WallShift>(
  shifts: readonly S[],
): readonly [S, S] | null {
  const sorted = [...shifts].sort((a, b) => spanOf(a).start - spanOf(b).start);
  let reach = sorted[0];
  for (const next of sorted.slice(1)) {
    if (reach === undefined) break;
    if (spanOf(next).start < spanOf(reach).end) return [reach, next];
    if (spanOf(next).end > spanOf(reach).end) reach = next;
  }
  return null;
}

/**
 * The first existing row that shares a minute with one of the wanted rows, or null. Only pairs with a
 * wanted row count, so an old clash between two existing rows never blocks an unrelated save; the
 * caller checks the wanted rows against each other with `findShiftOverlap`.
 */
export function findShiftClash<S extends WallShift>(
  existing: readonly S[],
  wanted: readonly WallShift[],
): S | null {
  for (const row of existing) {
    if (wanted.some((next) => findShiftOverlap<WallShift>([row, next]) !== null)) return row;
  }
  return null;
}

// Back-to-back rows join (D-14); Saturday 24:00 meets Sunday 00:00, so the week's last span is also
// written once more, continued into the first.
function continuousSpans(shifts: readonly WallShift[]): Span[] {
  const out: Span[] = [];
  for (const span of shifts.map(spanOf).sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  const first = out[0];
  const last = out.at(-1);
  if (first !== undefined && last !== undefined && first.start === 0) {
    if (last.end === WEEK_MINUTES) out.push({ start: last.start, end: WEEK_MINUTES + first.end });
  }
  return out;
}

/**
 * Is the wall-clock interval (its weekday and minute after midnight, then its length) inside one
 * continuous shift? Rows of ONE branch only: the caller filters (D-6, D-14).
 */
export function coversWallInterval(
  shifts: readonly WallShift[],
  start: { weekday: number; minute: number },
  durationMinutes: number,
): boolean {
  const from = start.weekday * MINUTES_PER_DAY + start.minute;
  const to = from + durationMinutes;
  return continuousSpans(shifts).some(
    (s) =>
      (s.start <= from && to <= s.end) ||
      (s.start <= from + WEEK_MINUTES && to + WEEK_MINUTES <= s.end),
  );
}
