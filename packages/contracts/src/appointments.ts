import { z } from "zod";
import { instantToWall } from "./clinic-time.ts";
import { idSchema, stripInvisibleControls } from "./common.ts";
import {
  coversWallInterval,
  scheduleBranchSchema,
  wallMinutes,
  type WallShift,
} from "./schedules.ts";
import { DURATION_MAX_MINUTES, DURATION_MIN_MINUTES } from "./services.ts";

// Slice A2 (docs/specs/appointments-design.md §4, ADR-0026): one booking of a patient with a provider in
// a branch. The pure rules below are shared by the API and the web mock, so both decide identically.

export const APPOINTMENT_STATUSES = [
  "booked",
  "arrived",
  "completed",
  "no_show",
  "cancelled",
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/** D-11: why an appointment was cancelled. */
export const CANCEL_REASONS = ["patient_cancelled", "provider_cancelled", "other"] as const;
export const cancelReasonSchema = z.enum(CANCEL_REASONS);
export type CancelReason = z.infer<typeof cancelReasonSchema>;

/** D-5: the only moves. `cancelled` goes through the cancel route, which requires a reason. */
export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  booked: ["arrived", "no_show", "cancelled"],
  arrived: ["completed", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
};

export const canTransition = (from: AppointmentStatus, to: AppointmentStatus): boolean =>
  APPOINTMENT_TRANSITIONS[from].includes(to);

/** Only a booked appointment moves in time; an arrived visit is already happening (ADR-0026 §11). */
export const isReschedulable = (status: AppointmentStatus): boolean => status === "booked";

/**
 * An instant on a whole minute: schedules and the grid work in minutes, so seconds could slip a slot past
 * the end of a shift unchecked (Codex A2 r2).
 */
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) % 60_000 === 0, "validation.time");

/** Whole minutes from one instant to another. */
export const minutesBetween = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / 60_000;

/** D-15: every appointment lasts 5 minutes to 8 hours. */
export const isAppointmentLength = (from: string, to: string): boolean => {
  const minutes = minutesBetween(from, to);
  return minutes >= DURATION_MIN_MINUTES && minutes <= DURATION_MAX_MINUTES;
};

const lengthRule = {
  message: "validation.duration",
  path: ["endsAt"],
};

/**
 * `POST /v1/appointments` (Idempotency-Key required). `endsAt: null` = the service's duration, else the
 * provider's default (rule 4). `overbook` asks to lift rule 2's checks; it needs `overbook:appointments`.
 */
export const appointmentInputSchema = z
  .object({
    branchId: idSchema,
    providerMembershipId: idSchema,
    patientId: idSchema,
    serviceId: idSchema.nullable(),
    startsAt: instant,
    endsAt: instant.nullable(),
    overbook: z.boolean(),
  })
  .strict()
  .refine((v) => v.endsAt === null || isAppointmentLength(v.startsAt, v.endsAt), lengthRule);
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

/** `PUT /v1/appointments/:id`: a new time, and optionally another provider or branch (rule 6). */
export const appointmentRescheduleSchema = z
  .object({
    branchId: idSchema,
    providerMembershipId: idSchema,
    startsAt: instant,
    endsAt: instant,
    overbook: z.boolean(),
  })
  .strict()
  .refine((v) => isAppointmentLength(v.startsAt, v.endsAt), lengthRule);
export type AppointmentRescheduleInput = z.infer<typeof appointmentRescheduleSchema>;

/** `POST /v1/appointments/:id/status`: every move but the cancel. */
export const appointmentStatusInputSchema = z
  .object({ status: z.enum(["arrived", "completed", "no_show"]) })
  .strict();
export type AppointmentStatusInput = z.infer<typeof appointmentStatusInputSchema>;

const cancelNote = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().max(200, "validation.tooLong"));

/** `POST /v1/appointments/:id/cancel` (D-11): a reason from the list, an optional short note. */
export const appointmentCancelSchema = z
  .object({ reason: cancelReasonSchema, note: cancelNote.nullable() })
  .strict();
export type AppointmentCancelInput = z.input<typeof appointmentCancelSchema>;
export type AppointmentCancel = z.infer<typeof appointmentCancelSchema>;

/** One appointment as the caller sees it (times UTC; the screen shows them in the clinic's zone). */
export const appointmentSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    providerMembershipId: idSchema,
    providerName: z.string(),
    patientId: idSchema,
    patientName: z.string(),
    patientFileNumber: z.number().int(),
    serviceId: idSchema.nullable(),
    serviceNameAr: z.string().nullable(),
    serviceNameEn: z.string().nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    status: appointmentStatusSchema,
    overbooked: z.boolean(),
    cancelReason: cancelReasonSchema.nullable(),
    cancelNote: z.string().nullable(),
  })
  .strict();
export type Appointment = z.infer<typeof appointmentSchema>;

/**
 * Every appointments write answers with the appointment as the caller's `view:appointments` keys show
 * it, or `null` when they do not reach its branch (refetch the day instead of reading it).
 */
export const appointmentWriteResponseSchema = z
  .object({ appointment: appointmentSchema.nullable() })
  .strict();
export type AppointmentWriteResponse = z.infer<typeof appointmentWriteResponseSchema>;

/** A real calendar day as `YYYY-MM-DD` (2027-02-29 and 2027-99-99 are refused). */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "validation.dateRequired");

export const appointmentDayQuerySchema = z
  .object({ branchId: idSchema, date: calendarDate })
  .strict();
export type AppointmentDayQuery = z.infer<typeof appointmentDayQuerySchema>;

/** A provider column of the branch day: the weekday's rows in this branch (wall time) and time off. */
export const dayProviderSchema = z
  .object({
    membershipId: idSchema,
    fullName: z.string(),
    defaultDurationMinutes: z.number().int(),
    bookable: z.boolean(),
    shifts: z.array(z.object({ startsAt: z.string(), endsAt: z.string() }).strict()),
    timeOff: z.array(
      z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }).strict(),
    ),
  })
  .strict();
export type DayProvider = z.infer<typeof dayProviderSchema>;

/**
 * `GET /v1/appointments/day`: one branch, one clinic-calendar date. `can` says what the caller may do in
 * this branch (UX only: the API refuses as well).
 */
export const appointmentDaySchema = z
  .object({
    branch: scheduleBranchSchema,
    date: z.string(),
    timezone: z.string(),
    providers: z.array(dayProviderSchema),
    appointments: z.array(appointmentSchema),
    can: z.object({ create: z.boolean(), update: z.boolean(), overbook: z.boolean() }).strict(),
  })
  .strict();
export type AppointmentDay = z.infer<typeof appointmentDaySchema>;

/** `GET /v1/appointments/branches`: the active branches the caller's view keys reach. */
export const appointmentBranchesSchema = z
  .object({ items: z.array(scheduleBranchSchema) })
  .strict();
export type AppointmentBranches = z.infer<typeof appointmentBranchesSchema>;

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
