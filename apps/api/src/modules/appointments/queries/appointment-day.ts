import type {
  AppointmentBranches,
  AppointmentDay,
  AppointmentDayQuery,
  DayProvider,
  TimeSpan,
} from "@eyadex/contracts/appointments";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import type { Database } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import { actorReach, type AppointmentActor } from "../domain/booking-rules.ts";
import { providerWorksIn, reachCovers } from "../domain/scheduling-scope.ts";
import { branchDayRows } from "../persistence/pg-appointment-store.ts";
import { readScheduleRows, readTimeOffOverlapping } from "../persistence/pg-schedule-store.ts";
import type { BookingPatientReader } from "../ports/booking-patient-reader.ts";
import type { ProviderDirectory, ProviderRecord } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";
import { projectAppointments } from "./appointment-views.ts";

/** What the day view needs: the pool and the module's three ports. */
export interface DayDeps {
  readonly db: Database;
  readonly providers: ProviderDirectory;
  readonly branches: SchedulingBranchReader;
  readonly patients: BookingPatientReader;
}

const nextDate = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The clinic-calendar day as instants: its midnight to the next one, in the clinic's zone (rule 11). */
export function clinicDay(date: string, timezone: string): TimeSpan {
  return {
    startsAt: wallToInstant(date, "00:00", timezone),
    endsAt: wallToInstant(nextDate(date), "00:00", timezone),
  };
}

/**
 * `GET /v1/appointments/branches`: the active branches the caller's view keys reach.
 *
 * @param deps the pool and ports
 * @param actor the caller
 * @returns the branches, active ones by name
 */
export function listAppointmentBranches(
  deps: DayDeps,
  actor: AppointmentActor,
): Promise<AppointmentBranches> {
  const reach = actorReach(actor, "view");
  return deps.db.withTenant(actor.clinicId, async (tx) => {
    const all = await deps.branches.listForOptions(tx, actor.clinicId, actor.language);
    return { items: all.filter((b) => b.isActive && reachCovers(reach, b.id)) };
  });
}

/**
 * `GET /v1/appointments/day` (spec §5 branch day): one column per bookable provider working in the branch
 * (and any provider holding an appointment that day), that weekday's rows of this branch, time off, and
 * the live appointments. A branch outside the caller's view keys is `not_found`.
 *
 * @param deps the pool and ports
 * @param actor the caller
 * @param query the branch and the clinic-calendar date
 * @returns the day
 */
export function readAppointmentDay(
  deps: DayDeps,
  actor: AppointmentActor,
  query: AppointmentDayQuery,
): Promise<AppointmentDay> {
  const { clinicId, timezone } = actor;
  return deps.db.withTenant(clinicId, async (tx) => {
    const branch = (await deps.branches.listForOptions(tx, clinicId, actor.language)).find(
      (b) => b.id === query.branchId,
    );
    if (branch === undefined || !reachCovers(actorReach(actor, "view"), branch.id)) {
      throw new ApiError("not_found");
    }
    const day = clinicDay(query.date, timezone);
    const weekday = new Date(`${query.date}T00:00:00Z`).getUTCDay();
    const rows = await branchDayRows(tx, clinicId, branch.id, day);
    const columns = new Map<string, ProviderRecord>();
    for (const p of await deps.providers.listBookable(tx, clinicId)) {
      if (providerWorksIn(p, branch.id)) columns.set(p.membershipId, p);
    }
    for (const id of new Set(rows.map((r) => r.providerMembershipId))) {
      const p = columns.has(id) ? null : await deps.providers.find(tx, clinicId, id);
      if (p !== null) columns.set(id, p);
    }
    const providers: DayProvider[] = [];
    for (const p of columns.values()) {
      const shifts = (await readScheduleRows(tx, clinicId, p.membershipId))
        .filter((s) => s.branchId === branch.id && s.weekday === weekday)
        .map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt }));
      providers.push({
        membershipId: p.membershipId,
        fullName: p.fullName,
        defaultDurationMinutes: p.defaultDurationMinutes,
        bookable: p.active && p.acceptsAppointments && providerWorksIn(p, branch.id),
        shifts,
        timeOff: await readTimeOffOverlapping(tx, clinicId, p.membershipId, day),
      });
    }
    providers.sort(
      (a, b) => a.fullName.localeCompare(b.fullName) || (a.membershipId < b.membershipId ? -1 : 1),
    );
    const create = branch.isActive && reachCovers(actorReach(actor, "create"), branch.id);
    const update = reachCovers(actorReach(actor, "update"), branch.id);
    const overbook = (create || update) && reachCovers(actorReach(actor, "overbook"), branch.id);
    return {
      branch: {
        id: branch.id,
        nameAr: branch.nameAr,
        nameEn: branch.nameEn,
        isActive: branch.isActive,
      },
      date: query.date,
      timezone,
      providers,
      appointments: await projectAppointments(
        { tx, providers: deps.providers, patients: deps.patients },
        clinicId,
        rows,
      ),
      can: { create, update, overbook },
    };
  });
}
