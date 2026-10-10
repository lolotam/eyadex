import { z } from "zod";
import type {
  Appointment,
  AppointmentInput,
  AppointmentRescheduleInput,
} from "@eyadex/contracts/appointments";
import { instantToWall, wallTimeExists, wallToInstant } from "@eyadex/contracts/clinic-time";
import { minutesToWall, wallMinutes } from "@eyadex/contracts/schedules";
import { errorCodeOf } from "@/shared/api/api-error";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The service select's "no service" value (a select item cannot be empty). */
export const NO_SERVICE = "none";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The booking dialog's fields, in clinic wall time (rule 11); an end before the start is the next day. */
export const bookingFormSchema = z.object({
  patientId: z.string().min(1, "validation.required"),
  providerMembershipId: z.string().min(1, "validation.required"),
  serviceId: z.string(),
  date: z.string().regex(DATE, "validation.dateRequired"),
  startTime: z.string().regex(HHMM, "validation.time"),
  endTime: z.string().regex(HHMM, "validation.time"),
  overbook: z.boolean(),
});
export type BookingForm = z.infer<typeof bookingFormSchema>;

/** `HH:MM` that many minutes after `time`, past midnight wrapping round. */
export function endFor(time: string, minutes: number): string {
  return minutesToWall((wallMinutes(time) + minutes) % (24 * 60));
}

const endDateOf = (values: BookingForm) =>
  wallMinutes(values.endTime) <= wallMinutes(values.startTime)
    ? new Date(Date.parse(`${values.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : values.date;

function interval(values: BookingForm, timeZone: string) {
  const startsAt = wallToInstant(values.date, values.startTime, timeZone);
  return { startsAt, endsAt: wallToInstant(endDateOf(values), values.endTime, timeZone) };
}

const MINUTE = 60_000;

/**
 * The end after a start kept as an instant: the first instant after the start that reads the end's wall
 * time, on the start's date or the next. Inside a repeated hour `wallToInstant` picks one reading, which
 * could put the end an hour off (or before) a start kept on the other reading, and an end that reads
 * earlier than the start can still be minutes later on the fallen-back clock. Clocks move by 30 or 60.
 */
function endAfter(startsAt: string, values: BookingForm, timeZone: string): string {
  const start = Date.parse(startsAt);
  const nextDay = new Date(Date.parse(`${values.date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const readings = [values.date, nextDay].flatMap((date) => {
    const guess = Date.parse(wallToInstant(date, values.endTime, timeZone));
    return [-60, -30, 0, 30, 60]
      .map((shift) => guess + shift * MINUTE)
      .filter((at) => {
        const wall = instantToWall(new Date(at).toISOString(), timeZone);
        return at > start && wall.date === date && wall.time === values.endTime;
      });
  });
  return readings.length > 0
    ? new Date(Math.min(...readings)).toISOString()
    : interval(values, timeZone).endsAt;
}

/**
 * Rule 4's pre-filled end: the start plus the length on the real clock when the start is still the
 * clicked slot's instant (a fall-back hour is not 60 minutes of wall time), else on the wall clock.
 */
export function prefilledEnd(
  values: Pick<BookingForm, "date" | "startTime">,
  minutes: number,
  timeZone: string,
  slotStartsAt?: string,
): string {
  if (slotStartsAt === undefined) return endFor(values.startTime, minutes);
  const slot = instantToWall(slotStartsAt, timeZone);
  if (slot.date !== values.date || slot.time !== values.startTime) {
    return endFor(values.startTime, minutes);
  }
  const end = new Date(Date.parse(slotStartsAt) + minutes * MINUTE).toISOString();
  return instantToWall(end, timeZone).time;
}

/**
 * The time field the clinic's clock skips on that date (a daylight-saving jump), or null: converting it
 * would silently book another hour than the one typed (Codex A2 r1).
 */
export function skippedTimeField(
  values: BookingForm,
  timeZone: string,
): "startTime" | "endTime" | null {
  if (!wallTimeExists(values.date, values.startTime, timeZone)) return "startTime";
  if (!wallTimeExists(endDateOf(values), values.endTime, timeZone)) return "endTime";
  return null;
}

/**
 * A new booking. `slotStartsAt` is the clicked slot's instant: a start left as the slot showed it keeps
 * that instant, since on a fall-back day its wall time names two slots and converting it back could pick
 * the other one (Codex PR #64). A start the user edited is read as typed.
 */
export function toAppointmentInput(
  values: BookingForm,
  branchId: string,
  timeZone: string,
  slotStartsAt?: string,
): AppointmentInput {
  const slot = slotStartsAt === undefined ? null : instantToWall(slotStartsAt, timeZone);
  const kept =
    slotStartsAt !== undefined &&
    slot !== null &&
    slot.date === values.date &&
    slot.time === values.startTime;
  return {
    branchId,
    providerMembershipId: values.providerMembershipId,
    patientId: values.patientId,
    serviceId: values.serviceId === NO_SERVICE ? null : values.serviceId,
    ...(kept
      ? { startsAt: slotStartsAt, endsAt: endAfter(slotStartsAt, values, timeZone) }
      : interval(values, timeZone)),
    overbook: values.overbook,
  };
}

/**
 * A move. Time fields left as the appointment had them keep its exact instants: a wall time inside a
 * repeated hour names two instants, and converting it back could pick the other one (Codex A2 r3).
 */
export function toRescheduleInput(
  values: BookingForm,
  branchId: string,
  timeZone: string,
  original?: Appointment,
): AppointmentRescheduleInput {
  const was = original === undefined ? null : formOf(original, timeZone);
  const untouched =
    original !== undefined &&
    was !== null &&
    was.date === values.date &&
    was.startTime === values.startTime &&
    was.endTime === values.endTime;
  return {
    branchId,
    providerMembershipId: values.providerMembershipId,
    ...(untouched
      ? { startsAt: original.startsAt, endsAt: original.endsAt }
      : interval(values, timeZone)),
    overbook: values.overbook,
  };
}

/** The form of an existing appointment (reschedule). */
export function formOf(appointment: Appointment, timeZone: string): BookingForm {
  const start = instantToWall(appointment.startsAt, timeZone);
  return {
    patientId: appointment.patientId,
    providerMembershipId: appointment.providerMembershipId,
    serviceId: appointment.serviceId ?? NO_SERVICE,
    date: start.date,
    startTime: start.time,
    endTime: instantToWall(appointment.endsAt, timeZone).time,
    // A move asks for overbook only when the mover switches it on (it needs the key; Codex A2 r1).
    overbook: false,
  };
}

/** The rule-2 refusals the dialog explains next to the time fields; anything else is a toast. */
const SLOT_CODES = ["outside_schedule", "provider_time_off", "appointment_overlap"] as const;
export type SlotCode = (typeof SLOT_CODES)[number];

export function slotRefusal(error: unknown): SlotCode | null {
  const code = errorCodeOf(error);
  return (SLOT_CODES as readonly string[]).includes(code) ? (code as SlotCode) : null;
}
