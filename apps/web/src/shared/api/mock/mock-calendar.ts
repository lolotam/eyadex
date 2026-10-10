import {
  appointmentMonthQuerySchema,
  appointmentMonthSchema,
  appointmentWeekQuerySchema,
  appointmentWeekSchema,
  type AppointmentMonth,
  type AppointmentWeek,
} from "@eyadex/contracts/appointment-calendar";
import { clinicDayBounds, instantToWall } from "@eyadex/contracts/clinic-time";
import type { z } from "zod";
import { ApiError } from "../api-error";
import type { AppointmentsApi } from "../appointments-client";
import { authorizeAppointments, project, type AppointmentAccess } from "./mock-appointment-rules";
import { profileOf, reachCovers, worksIn } from "./mock-scheduling-rules";
import { delay, getState, type MockState } from "./mock-store";

// The API's provider week and month (slice A4, appointment-calendar.ts) for the mock: the day's branch
// rule, `own` reads only the caller's provider (another one is not_found), cancelled never counts.

function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

const dateAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const touches = (
  x: { startsAt: string; endsAt: string },
  span: { startsAt: string; endsAt: string },
) =>
  Date.parse(x.startsAt) < Date.parse(span.endsAt) &&
  Date.parse(x.endsAt) > Date.parse(span.startsAt);

/** The branch the caller's view reaches (under `own`: its own branches), else not_found as the day. */
function reachedBranch(db: MockState, a: AppointmentAccess, branchId: string) {
  const branch = db.branches.find((b) => b.clinicId === a.clinic.id && b.id === branchId);
  if (!branch || !reachCovers(a.dayReach, branch.id)) throw new ApiError("not_found");
  return branch;
}

/** Under `own` only the caller is readable; another provider is not_found, never forbidden. */
function assertProvider(a: AppointmentAccess, providerId: string | undefined) {
  if (a.own !== null && providerId !== undefined && providerId !== a.own) {
    throw new ApiError("not_found");
  }
}

function week(db: MockState, a: AppointmentAccess, q: z.infer<typeof appointmentWeekQuerySchema>) {
  const branch = reachedBranch(db, a, q.branchId);
  assertProvider(a, q.providerMembershipId);
  const member = db.members.find(
    (m) => m.clinicId === a.clinic.id && m.id === q.providerMembershipId,
  );
  if (!member) throw new ApiError("not_found");
  const tz = a.clinic.timezone;
  const dates = Array.from({ length: 7 }, (_, i) => dateAfter(q.weekStart, i));
  const span = {
    startsAt: clinicDayBounds(dates[0]!, tz).startsAt,
    endsAt: clinicDayBounds(dates[6]!, tz).endsAt,
  };
  const profile = profileOf(db, member.id);
  const days = dates.map((date) => {
    const bounds = clinicDayBounds(date, tz);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      date,
      shifts: db.scheduleRows
        .filter(
          (r) => r.membershipId === member.id && r.branchId === branch.id && r.weekday === weekday,
        )
        .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
        .map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt })),
      timeOff: db.timeOff
        .filter((t) => t.membershipId === member.id && t.cancelledAt === null && touches(t, bounds))
        .map((t) => ({ startsAt: t.startsAt, endsAt: t.endsAt })),
    };
  });
  const appointments = db.appointments
    .filter(
      (x) =>
        x.clinicId === a.clinic.id &&
        x.branchId === branch.id &&
        x.providerMembershipId === member.id &&
        x.status !== "cancelled" &&
        touches(x, span),
    )
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt) || x.id.localeCompare(y.id))
    .map((x) => project(db, x));
  const create = branch.isActive && reachCovers(a.reach("create"), branch.id);
  const update = reachCovers(a.reach("update"), branch.id);
  const result: AppointmentWeek = {
    branch: {
      id: branch.id,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      isActive: branch.isActive,
    },
    weekStart: q.weekStart,
    timezone: tz,
    provider: {
      membershipId: member.id,
      fullName: member.fullName,
      defaultDurationMinutes: profile.defaultDurationMinutes,
      bookable:
        member.status === "active" && profile.acceptsAppointments && worksIn(member, branch.id),
    },
    days,
    appointments,
    can: {
      create,
      update,
      overbook: (create || update) && reachCovers(a.reach("overbook"), branch.id),
    },
  };
  return appointmentWeekSchema.parse(result);
}

function month(
  db: MockState,
  a: AppointmentAccess,
  q: z.infer<typeof appointmentMonthQuerySchema>,
) {
  const branch = reachedBranch(db, a, q.branchId);
  assertProvider(a, q.providerMembershipId);
  const provider = a.own ?? q.providerMembershipId ?? null;
  const tz = a.clinic.timezone;
  const [year, mon] = q.month.split("-").map(Number) as [number, number];
  const length = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const counts = new Map<string, number>();
  for (const x of db.appointments) {
    if (x.clinicId !== a.clinic.id || x.branchId !== branch.id || x.status === "cancelled")
      continue;
    if (provider !== null && x.providerMembershipId !== provider) continue;
    const date = instantToWall(x.startsAt, tz).date;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const result: AppointmentMonth = {
    branch: {
      id: branch.id,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      isActive: branch.isActive,
    },
    month: q.month,
    timezone: tz,
    days: Array.from({ length }, (_, i) => {
      const date = `${q.month}-${String(i + 1).padStart(2, "0")}`;
      return { date, count: counts.get(date) ?? 0 };
    }),
  };
  return appointmentMonthSchema.parse(result);
}

export function createMockCalendar(): Pick<AppointmentsApi, "week" | "month"> {
  return {
    async week(persona, raw) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "view");
      return week(db, a, parse(appointmentWeekQuerySchema, raw));
    },
    async month(persona, raw) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "view");
      return month(db, a, parse(appointmentMonthQuerySchema, raw));
    },
  };
}
