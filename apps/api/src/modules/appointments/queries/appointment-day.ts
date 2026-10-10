import type { TimeSpan } from "@eyadex/contracts/appointment-slots";
import type {
  AppointmentBranches,
  AppointmentDay,
  AppointmentDayQuery,
  DayProvider,
} from "@eyadex/contracts/appointments";
import { clinicDayBounds } from "@eyadex/contracts/clinic-time";
import type { Database, Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  actorReach,
  actorViewReach,
  dayBranches,
  type AppointmentActor,
} from "../domain/booking-rules.ts";
import { providerWorksIn, reachCovers } from "../domain/scheduling-scope.ts";
import { branchDayRows } from "../persistence/pg-appointment-store.ts";
import {
  readBranchDayShifts,
  readTimeOffOverlappingFor,
} from "../persistence/pg-schedule-store.ts";
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

/**
 * The clinic-calendar day as instants: its first real instant to the next day's, in the clinic's zone
 * (rule 11), also when a clock change skips or repeats midnight (ADR-0026 A3).
 */
export function clinicDay(date: string, timezone: string): TimeSpan {
  return clinicDayBounds(date, timezone);
}

/** A branch as the scheduling reads return it. */
type SchedulingBranch = AppointmentDay["branch"];

/**
 * The branch a calendar read opens: one the caller's view keys reach (under `own`, a branch of the
 * caller's membership), else `not_found` — an unreachable branch and an unknown one answer alike.
 *
 * @param deps the pool and ports
 * @param tx the tenant transaction
 * @param actor the caller
 * @param branchId the branch asked for
 * @returns the branch
 */
export async function reachableBranch(
  deps: DayDeps,
  tx: Tx,
  actor: AppointmentActor,
  branchId: string,
): Promise<SchedulingBranch> {
  const branch = (await deps.branches.listForOptions(tx, actor.clinicId, actor.language)).find(
    (b) => b.id === branchId,
  );
  if (
    branch === undefined ||
    !reachCovers(dayBranches(actorViewReach(actor), actor.member), branch.id)
  ) {
    throw new ApiError("not_found");
  }
  return branchOf(branch);
}

/** The contract's branch fields only, whatever else the reader returned. */
function branchOf(branch: SchedulingBranch): SchedulingBranch {
  return { id: branch.id, nameAr: branch.nameAr, nameEn: branch.nameEn, isActive: branch.isActive };
}

/**
 * What the caller may do in this branch (UX only: the API refuses as well). Overbooking needs a booking
 * or moving key there too.
 *
 * @param actor the caller
 * @param branch the branch
 * @returns the three switches
 */
export function branchCan(
  actor: AppointmentActor,
  branch: SchedulingBranch,
): AppointmentDay["can"] {
  const create = branch.isActive && reachCovers(actorReach(actor, "create"), branch.id);
  const update = reachCovers(actorReach(actor, "update"), branch.id);
  const overbook = (create || update) && reachCovers(actorReach(actor, "overbook"), branch.id);
  return { create, update, overbook };
}

/**
 * `GET /v1/appointments/branches`: the active branches the caller's view keys reach; under `own` only,
 * the active branches of the caller's membership (ADR-0026 A3, TODO(spec) 2).
 *
 * @param deps the pool and ports
 * @param actor the caller
 * @returns the branches, active ones by name
 */
export function listAppointmentBranches(
  deps: DayDeps,
  actor: AppointmentActor,
): Promise<AppointmentBranches> {
  const reach = dayBranches(actorViewReach(actor), actor.member);
  return deps.db.withTenant(actor.clinicId, async (tx) => {
    const all = await deps.branches.listForOptions(tx, actor.clinicId, actor.language);
    return { items: all.filter((b) => b.isActive && reachCovers(reach, b.id)) };
  });
}

/**
 * `GET /v1/appointments/day` (spec §5 branch day): one column per bookable provider working in the branch
 * (and any provider holding an appointment that day), that weekday's rows of this branch, time off, and
 * the live appointments. A branch outside the caller's view keys is `not_found`. Under `own` only
 * (ADR-0026 A3) a branch of the caller's membership shows the caller's column alone: no other provider's
 * name, id, shifts or appointments, and no column at all when the caller would not have one.
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
    const branch = await reachableBranch(deps, tx, actor, query.branchId);
    const view = actorViewReach(actor);
    const only = "own" in view ? view.own : null;
    const shown = (membershipId: string) => only === null || membershipId === only;
    const day = clinicDay(query.date, timezone);
    const weekday = new Date(`${query.date}T00:00:00Z`).getUTCDay();
    const rows = (await branchDayRows(tx, clinicId, branch.id, day)).filter((r) =>
      shown(r.providerMembershipId),
    );
    // A constant number of statements however many columns the branch has (Codex A2 PR #64).
    const columns = new Map<string, ProviderRecord>();
    for (const p of await deps.providers.listBookable(tx, clinicId)) {
      if (providerWorksIn(p, branch.id) && shown(p.membershipId)) columns.set(p.membershipId, p);
    }
    const holders = [...new Set(rows.map((r) => r.providerMembershipId))];
    const missing = holders.filter((id) => !columns.has(id));
    for (const [id, p] of await deps.providers.findMany(tx, clinicId, missing)) columns.set(id, p);
    const ids = [...columns.keys()];
    const shifts = await readBranchDayShifts(tx, clinicId, ids, branch.id, weekday);
    const timeOff = await readTimeOffOverlappingFor(tx, clinicId, ids, day);
    const providers: DayProvider[] = [...columns.values()].map((p) => ({
      membershipId: p.membershipId,
      fullName: p.fullName,
      defaultDurationMinutes: p.defaultDurationMinutes,
      bookable: p.active && p.acceptsAppointments && providerWorksIn(p, branch.id),
      shifts: shifts.get(p.membershipId) ?? [],
      timeOff: timeOff.get(p.membershipId) ?? [],
    }));
    providers.sort(
      (a, b) => a.fullName.localeCompare(b.fullName) || (a.membershipId < b.membershipId ? -1 : 1),
    );
    return {
      branch,
      date: query.date,
      timezone,
      providers,
      appointments: await projectAppointments(
        { tx, providers: deps.providers, patients: deps.patients },
        clinicId,
        rows,
      ),
      can: branchCan(actor, branch),
    };
  });
}
