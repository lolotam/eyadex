import { z } from "zod";
import { instantToWall, wallTimeExists, wallToInstant } from "@eyadex/contracts/clinic-time";
import {
  wallMinutes,
  type BranchScheduleInput,
  type ProviderSchedule,
  type ScheduleBranch,
  type TimeOffInput,
} from "@eyadex/contracts/schedules";
import { ApiError } from "@/shared/api/api-error";

/** i18n keys of the weekdays, index = the contract's weekday (0 = Sunday). */
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** One editable row; `key` only keeps React's list stable while rows are added and removed. */
export type WeekRow = { key: string; weekday: number; startsAt: string; endsAt: string };

export function rowsForBranch(schedule: ProviderSchedule, branchId: string): WeekRow[] {
  return schedule.shifts
    .filter((s) => s.branchId === branchId)
    .sort((a, b) => a.weekday - b.weekday || wallMinutes(a.startsAt) - wallMinutes(b.startsAt))
    .map((s) => ({
      key: crypto.randomUUID(),
      weekday: s.weekday,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    }));
}

/**
 * The other branch a refused week overlaps, when the API named it (only inside the caller's reach)
 * and this schedule shows it; null means the generic overlap message.
 */
export function clashBranch(
  schedule: ProviderSchedule,
  branchId: string,
  error: unknown,
): ScheduleBranch | null {
  if (!(error instanceof ApiError) || error.code !== "schedule_overlap") return null;
  const named = error.details["branchId"];
  if (named === undefined || named === branchId) return null;
  return [...schedule.branches, ...schedule.dormantBranches].find((b) => b.id === named) ?? null;
}

export function toWeekInput(rows: WeekRow[]): BranchScheduleInput {
  return { shifts: rows.map(({ weekday, startsAt, endsAt }) => ({ weekday, startsAt, endsAt })) };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.dateRequired");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "validation.time");

/** The dialog's fields: clinic wall-clock dates and times (the API takes instants). */
export const timeOffFormSchema = z.object({
  startDate: date,
  startTime: time,
  endDate: date,
  endTime: time,
  note: z.string().max(200, "validation.tooLong"),
});
export type TimeOffForm = z.infer<typeof timeOffFormSchema>;

export function toTimeOffInput(form: TimeOffForm, timeZone: string): TimeOffInput {
  return {
    startsAt: wallToInstant(form.startDate, form.startTime, timeZone),
    endsAt: wallToInstant(form.endDate, form.endTime, timeZone),
    note: form.note.trim() === "" ? null : form.note.trim(),
  };
}

/** The field whose wall time the clinic's zone skips (a clock change), or null. */
export function skippedTimeField(
  form: TimeOffForm,
  timeZone: string,
): "startTime" | "endTime" | null {
  if (!wallTimeExists(form.startDate, form.startTime, timeZone)) return "startTime";
  if (!wallTimeExists(form.endDate, form.endTime, timeZone)) return "endTime";
  return null;
}

/** `YYYY-MM-DD HH:MM` in the clinic's zone. */
export function wallLabel(iso: string, timeZone: string): string {
  const { date: d, time: t } = instantToWall(iso, timeZone);
  return `${d} ${t}`;
}
