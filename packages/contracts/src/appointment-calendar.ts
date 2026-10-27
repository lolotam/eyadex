import { z } from "zod";
import { legacyNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";
import { utcDatetime } from "./datetime-compat.ts";
import { appointmentSchema, calendarDate } from "./appointments.ts";
import { idSchema } from "./common.ts";
import { scheduleBranchSchema } from "./schedules.ts";

/**
 * Slice A4 (spec §5): the provider week and the month. Today's queue needs no read of its own: it is the
 * branch day (`GET /v1/appointments/day`) for the clinic's today, with the A2 status and cancel routes.
 * Both reads are per branch, like the day, because every appointments key is branch-scoped; under `own`
 * only the caller's own provider is readable (ADR-0026 A3).
 */

/**
 * The years a calendar read accepts: the reads step past the period they show (the next month, the eighth
 * day), so a year at the edge of four digits would step out of `YYYY` and fail as a server error (Codex A4).
 */
const inCalendarYears = (value: string) => {
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2999;
};

/** A calendar month as `YYYY-MM`, in the calendar years. */
const calendarMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "validation.dateRequired")
  .refine(inCalendarYears, "validation.dateRequired");

/**
 * `GET /v1/appointments/week`: one provider in one branch, seven clinic-calendar days from `weekStart`
 * (the screen picks the clinic's first weekday; the API takes any date).
 */
export const appointmentWeekQuerySchema = z
  .object({
    branchId: idSchema,
    providerMembershipId: idSchema,
    weekStart: calendarDate.refine(inCalendarYears, "validation.dateRequired"),
  })
  .strict();
export type AppointmentWeekQuery = z.infer<typeof appointmentWeekQuerySchema>;

/** One day of the week: that weekday's rows of this branch (wall time) and time off touching the day. */
export const weekDaySchema = z
  .object({
    date: z.string(),
    shifts: z.array(z.object({ startsAt: z.string(), endsAt: z.string() }).strict()),
    timeOff: z.array(z.object({ startsAt: utcDatetime(), endsAt: utcDatetime() }).strict()),
  })
  .strict();
export type WeekDay = z.infer<typeof weekDaySchema>;

/**
 * The provider week. `days` holds exactly seven days in order; `appointments` are the live ones (not
 * cancelled) touching the week. A branch the caller's view keys do not reach, or a provider outside the
 * caller's `own`, is `not_found`. `can` is UX only, as on the day.
 */
export const appointmentWeekSchema = z
  .object({
    branch: scheduleBranchSchema,
    weekStart: z.string(),
    timezone: z.string(),
    provider: z
      .object({
        membershipId: idSchema,
        fullName: z.string(),
        defaultDurationMinutes: legacyNumber().check(legacyInteger()),
        bookable: z.boolean(),
      })
      .strict(),
    days: z.array(weekDaySchema).length(7),
    appointments: z.array(appointmentSchema),
    can: z.object({ create: z.boolean(), update: z.boolean(), overbook: z.boolean() }).strict(),
  })
  .strict();
export type AppointmentWeek = z.infer<typeof appointmentWeekSchema>;

/**
 * `GET /v1/appointments/month`: live appointments (not cancelled) per clinic-calendar day of one branch,
 * counted on the day each one starts. `providerMembershipId` narrows to one provider; under `own` the
 * count is always the caller's own, and another provider is `not_found`.
 */
export const appointmentMonthQuerySchema = z
  .object({
    branchId: idSchema,
    month: calendarMonth,
    providerMembershipId: idSchema.optional(),
  })
  .strict();
export type AppointmentMonthQuery = z.infer<typeof appointmentMonthQuerySchema>;

/** Every day of the month, in order, zero included. */
export const appointmentMonthSchema = z
  .object({
    branch: scheduleBranchSchema,
    month: z.string(),
    timezone: z.string(),
    days: z.array(
      z
        .object({
          date: z.string(),
          count: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
        })
        .strict(),
    ),
  })
  .strict();
export type AppointmentMonth = z.infer<typeof appointmentMonthSchema>;
