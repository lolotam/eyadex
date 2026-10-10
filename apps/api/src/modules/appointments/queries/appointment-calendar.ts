import type {
  AppointmentMonth,
  AppointmentMonthQuery,
  AppointmentWeek,
  AppointmentWeekQuery,
  WeekDay,
} from "@eyadex/contracts/appointment-calendar";
import { clinicDayBounds } from "@eyadex/contracts/clinic-time";

import { ApiError } from "../../../shared/errors.ts";
import { actorViewReach, type AppointmentActor } from "../domain/booking-rules.ts";
import { providerWorksIn } from "../domain/scheduling-scope.ts";
import { branchStartCounts, providerSpanRows } from "../persistence/pg-appointment-store.ts";
import { readScheduleRows, readTimeOffOverlappingFor } from "../persistence/pg-schedule-store.ts";
import { branchCan, reachableBranch, type DayDeps } from "./appointment-day.ts";
import { projectAppointments } from "./appointment-views.ts";

/** The calendar date `days` after `date`, both `YYYY-MM-DD` (pure calendar arithmetic, no zone). */
function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * The provider a calendar read counts: under `own` always the caller itself, and naming another
 * provider is `not_found` like an unknown one (ADR-0026 A3); a wider key reads the one named, or every
 * provider when none is (`null`).
 */
function readableProvider(actor: AppointmentActor, named: string | undefined): string | null {
  const view = actorViewReach(actor);
  if (!("own" in view)) return named ?? null;
  if (named !== undefined && named !== view.own) throw new ApiError("not_found");
  return view.own;
}

/**
 * `GET /v1/appointments/week` (spec §5 provider week): one provider in one branch for seven clinic days
 * from `weekStart` — each weekday's rows of this branch, time off touching each day, and the live
 * appointments touching the week. The branch follows the day's rule (ADR-0026 A3); a provider unknown to
 * the clinic, or another provider under `own`, is `not_found`.
 *
 * @param deps the pool and ports
 * @param actor the caller
 * @param query the branch, the provider and the first day
 * @returns the week
 */
export function readAppointmentWeek(
  deps: DayDeps,
  actor: AppointmentActor,
  query: AppointmentWeekQuery,
): Promise<AppointmentWeek> {
  const { clinicId, timezone } = actor;
  return deps.db.withTenant(clinicId, async (tx) => {
    const branch = await reachableBranch(deps, tx, actor, query.branchId);
    readableProvider(actor, query.providerMembershipId); // refuses another provider under own
    const providerId = query.providerMembershipId;
    const provider = (await deps.providers.findMany(tx, clinicId, [providerId])).get(providerId);
    if (provider === undefined) throw new ApiError("not_found");
    const dates = Array.from({ length: 7 }, (_, i) => addDays(query.weekStart, i));
    const bounds = dates.map((date) => clinicDayBounds(date, timezone));
    const week = { startsAt: bounds[0]!.startsAt, endsAt: bounds[6]!.endsAt };
    const rows = (await readScheduleRows(tx, clinicId, providerId)).filter(
      (r) => r.branchId === branch.id,
    );
    const timeOff =
      (await readTimeOffOverlappingFor(tx, clinicId, [providerId], week)).get(providerId) ?? [];
    const days: WeekDay[] = dates.map((date, i) => {
      const day = bounds[i]!;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        shifts: rows
          .filter((r) => r.weekday === weekday)
          .map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt })),
        timeOff: timeOff.filter((t) => t.startsAt < day.endsAt && t.endsAt > day.startsAt),
      };
    });
    const appointments = await providerSpanRows(tx, clinicId, branch.id, providerId, week);
    return {
      branch,
      weekStart: query.weekStart,
      timezone,
      provider: {
        membershipId: provider.membershipId,
        fullName: provider.fullName,
        defaultDurationMinutes: provider.defaultDurationMinutes,
        bookable:
          provider.active && provider.acceptsAppointments && providerWorksIn(provider, branch.id),
      },
      days,
      appointments: await projectAppointments(
        { tx, providers: deps.providers, patients: deps.patients },
        clinicId,
        appointments,
      ),
      can: branchCan(actor, branch),
    };
  });
}

/**
 * `GET /v1/appointments/month` (spec §5 month): the live appointments of one branch per clinic-calendar
 * day, counted on the day each one starts, every day of the month listed. Under `own` the count is the
 * caller's own (ADR-0026 A3).
 *
 * @param deps the pool and ports
 * @param actor the caller
 * @param query the branch, the month and an optional provider
 * @returns the month
 */
export function readAppointmentMonth(
  deps: DayDeps,
  actor: AppointmentActor,
  query: AppointmentMonthQuery,
): Promise<AppointmentMonth> {
  const { clinicId, timezone } = actor;
  return deps.db.withTenant(clinicId, async (tx) => {
    const branch = await reachableBranch(deps, tx, actor, query.branchId);
    const providerId = readableProvider(actor, query.providerMembershipId);
    const first = `${query.month}-01`;
    // 31 days after the 1st always lands in the next month, whatever this month's length.
    const next = addDays(first, 31).slice(0, 7);
    const span = {
      startsAt: clinicDayBounds(first, timezone).startsAt,
      endsAt: clinicDayBounds(`${next}-01`, timezone).startsAt,
    };
    const counts = await branchStartCounts(tx, clinicId, branch.id, providerId, span, timezone);
    const days: AppointmentMonth["days"] = [];
    for (let date = first; date.startsWith(query.month); date = addDays(date, 1)) {
      days.push({ date, count: counts.get(date) ?? 0 });
    }
    return { branch, month: query.month, timezone, days };
  });
}
