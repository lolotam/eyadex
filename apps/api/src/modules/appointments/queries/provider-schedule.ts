import type {
  ProviderListResponse,
  ProviderSchedule,
  ProviderSummary,
} from "@eyadex/contracts/schedules";
import type { Database, Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  providerWithin,
  providerWorksIn,
  reachCovers,
  type Reach,
} from "../domain/scheduling-scope.ts";
import { readScheduleRows, readUpcomingTimeOff } from "../persistence/pg-schedule-store.ts";
import type { ProviderDirectory, ProviderRecord } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";

/** What a schedules read needs: the transaction and the module's two ports. */
export interface ScheduleReads {
  readonly tx: Tx;
  readonly providers: ProviderDirectory;
  readonly branches: SchedulingBranchReader;
}

/** The caller of a schedules route: its clinic, the reach of the route's action, its sort language. */
export interface ScheduleViewer {
  readonly clinicId: string;
  readonly reach: Reach;
  readonly language: "ar" | "en";
}

const summaryOf = (p: ProviderRecord): ProviderSummary => ({
  membershipId: p.membershipId,
  fullName: p.fullName,
  defaultDurationMinutes: p.defaultDurationMinutes,
  allBranches: p.allBranches,
  branchIds: [...p.branchIds],
});

/**
 * The bookable members working in at least one branch inside the caller's reach (spec §5).
 *
 * @param db the `eyadex_app` pool
 * @param providers the module's ProviderDirectory
 * @param viewer the caller
 * @returns the providers, by name
 */
export async function listProviders(
  db: Database,
  providers: ProviderDirectory,
  viewer: ScheduleViewer,
): Promise<ProviderListResponse> {
  const rows = await db.withTenant(viewer.clinicId, (tx) =>
    providers.listBookable(tx, viewer.clinicId),
  );
  return { items: rows.filter((p) => providerWithin(viewer.reach, p)).map(summaryOf) };
}

/**
 * One provider's schedule as the caller may see it: its branches inside the reach, its rows there and
 * its time off that has not ended. A member outside the reach is `not_found` (no probing).
 *
 * @param reads the transaction and ports
 * @param viewer the caller
 * @param membershipId the provider
 * @param now the clock's now
 * @returns the schedule
 */
export async function readProviderSchedule(
  reads: ScheduleReads,
  viewer: ScheduleViewer,
  membershipId: string,
  now: Date,
): Promise<ProviderSchedule> {
  const { tx, providers, branches } = reads;
  const provider = await providers.find(tx, viewer.clinicId, membershipId);
  if (provider === null || !providerWithin(viewer.reach, provider)) throw new ApiError("not_found");
  const visible = (await branches.listForOptions(tx, viewer.clinicId, viewer.language)).filter(
    (b) => b.isActive && providerWorksIn(provider, b.id) && reachCovers(viewer.reach, b.id),
  );
  const ids = new Set(visible.map((b) => b.id));
  const rows = await readScheduleRows(tx, viewer.clinicId, membershipId);
  const timeOff = await readUpcomingTimeOff(tx, viewer.clinicId, membershipId, now);
  return {
    provider: summaryOf(provider),
    branches: visible.map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive })),
    shifts: rows
      .filter((r) => ids.has(r.branchId))
      .map(({ branchId, weekday, startsAt, endsAt }) => ({ branchId, weekday, startsAt, endsAt })),
    timeOff: timeOff.map((t) => ({
      id: t.id,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      note: t.note,
    })),
  };
}

/** The `GET /v1/schedules/:membershipId` read in its own transaction. */
export function readSchedule(
  db: Database,
  providers: ProviderDirectory,
  branches: SchedulingBranchReader,
  viewer: ScheduleViewer,
  membershipId: string,
  now: Date,
): Promise<ProviderSchedule> {
  return db.withTenant(viewer.clinicId, (tx) =>
    readProviderSchedule({ tx, providers, branches }, viewer, membershipId, now),
  );
}
