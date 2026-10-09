import type {
  ProviderListResponse,
  ProviderSchedule,
  ProviderSummary,
} from "@eyadex/contracts/schedules";
import type { Database, Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  branchesWithin,
  providerSeen,
  providerWithin,
  providerWorksIn,
  reachCovers,
  type Reach,
} from "../domain/scheduling-scope.ts";
import {
  readHeldBranchesByProvider,
  readHeldBranchIds,
  readScheduleRows,
  readUpcomingTimeOff,
} from "../persistence/pg-schedule-store.ts";
import type { ProviderDirectory, ProviderRecord } from "../ports/provider-directory.ts";
import type {
  SchedulingBranch,
  SchedulingBranchReader,
} from "../ports/scheduling-branch-reader.ts";

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

// Branch assignments outside the caller's reach stay hidden (Codex PR #63).
const summaryOf = (p: ProviderRecord, reach: Reach): ProviderSummary => {
  const { allBranches, branchIds } = branchesWithin(reach, p);
  return {
    membershipId: p.membershipId,
    fullName: p.fullName,
    defaultDurationMinutes: p.defaultDurationMinutes,
    allBranches,
    branchIds: [...branchIds],
  };
};

/**
 * Whether the caller sees this provider: it works in a branch inside `reach`, or still holds rows in
 * one (ADR-0026 §4). Its rows are read only when its assignments alone do not answer.
 *
 * @param tx the transaction, inside `withTenant(clinicId)`
 * @param clinicId the clinic
 * @param reach the caller's reach for the route
 * @param provider the provider
 * @returns `true` when visible
 */
export async function providerVisible(
  tx: Tx,
  clinicId: string,
  reach: Reach,
  provider: ProviderRecord,
): Promise<boolean> {
  if (providerWithin(reach, provider)) return true;
  return providerSeen(
    reach,
    provider,
    await readHeldBranchIds(tx, clinicId, provider.membershipId),
  );
}

/**
 * The bookable members working in at least one branch inside the caller's reach, or holding rows in
 * one (spec §5, ADR-0026 §4).
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
  const { clinicId, reach } = viewer;
  const rows = await db.withTenant(clinicId, async (tx) => {
    const bookable = await providers.listBookable(tx, clinicId);
    // Every provider is within a clinic-wide reach: the rows are read for a branch reach only.
    const held = reach.all
      ? new Map<string, string[]>()
      : await readHeldBranchesByProvider(tx, clinicId);
    return bookable.filter((p) => providerSeen(reach, p, held.get(p.membershipId) ?? []));
  });
  return { items: rows.map((p) => summaryOf(p, reach)) };
}

/**
 * One provider's schedule as the caller may see it: its live branches inside the reach, the dormant
 * branches inside the reach that still hold its rows, its rows in both, and its time off that has not
 * ended. A member neither working nor holding rows inside the reach is `not_found` (no probing).
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
  const provider = await reads.providers.find(reads.tx, viewer.clinicId, membershipId);
  if (
    provider === null ||
    !(await providerVisible(reads.tx, viewer.clinicId, viewer.reach, provider))
  )
    throw new ApiError("not_found");
  return projectSchedule(reads, viewer, provider, now);
}

/**
 * An already authorised provider's schedule clipped to `viewer.reach`, never throwing: a write answers
 * with it under the caller's view reach, which may cover less than the write's reach (Codex PR #63).
 *
 * @param reads the transaction and ports
 * @param viewer the caller, with the reach to clip to
 * @param provider the provider
 * @param now the clock's now
 * @returns the schedule
 */
export async function projectSchedule(
  reads: ScheduleReads,
  viewer: ScheduleViewer,
  provider: ProviderRecord,
  now: Date,
): Promise<ProviderSchedule> {
  const { tx, branches } = reads;
  const { membershipId } = provider;
  const rows = await readScheduleRows(tx, viewer.clinicId, membershipId);
  const held = new Set(rows.map((r) => r.branchId));
  const reached = (await branches.listForOptions(tx, viewer.clinicId, viewer.language)).filter(
    (b) => reachCovers(viewer.reach, b.id),
  );
  const live = (b: SchedulingBranch) => b.isActive && providerWorksIn(provider, b.id);
  const visible = reached.filter(live);
  // Rows kept in an inactive branch or one the provider left: shown so they can be cleared (ADR-0026 §4).
  const dormant = reached.filter((b) => !live(b) && held.has(b.id));
  const ids = new Set([...visible, ...dormant].map((b) => b.id));
  // Time off is not per branch: it shows only when the view keys reach the provider at all (Codex r2).
  const timeOff = providerWithin(viewer.reach, provider)
    ? await readUpcomingTimeOff(tx, viewer.clinicId, membershipId, now)
    : [];
  const branchOf = ({ id, nameAr, nameEn, isActive }: SchedulingBranch) => ({
    id,
    nameAr,
    nameEn,
    isActive,
  });
  return {
    provider: summaryOf(provider, viewer.reach),
    branches: visible.map(branchOf),
    dormantBranches: dormant.map(branchOf),
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
