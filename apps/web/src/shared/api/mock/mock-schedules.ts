import {
  branchScheduleInputSchema,
  findShiftClash,
  findShiftOverlap,
  timeOffInputSchema,
} from "@eyadex/contracts/schedules";
import type { ProviderSchedule, ScheduleBranch, WallShift } from "@eyadex/contracts/schedules";
import type { MembershipUser } from "@eyadex/contracts/users";
import { ApiError } from "../api-error";
import type { SchedulingApi } from "../scheduling-client";
import { writeClinicAudit } from "./mock-audit";
import {
  authorizeSchedules,
  branchesWithin,
  profileOf,
  providerWithin,
  reachCovers,
  shiftLabel,
  worksIn,
  type SchedulingAccess,
} from "./mock-scheduling-rules";
import {
  delay,
  getState,
  newId,
  persist,
  type MockState,
  type StoredShift,
  type StoredTimeOff,
} from "./mock-store";

type SchedulesApi = Pick<
  SchedulingApi,
  "listProviders" | "getProviderSchedule" | "replaceBranchSchedule" | "addTimeOff" | "cancelTimeOff"
>;

const summary = (db: MockState, a: SchedulingAccess, m: MembershipUser) => {
  const { allBranches, branchIds } = branchesWithin(a.reach, m);
  return {
    membershipId: m.id,
    fullName: m.fullName,
    defaultDurationMinutes: profileOf(db, m.id).defaultDurationMinutes,
    allBranches,
    branchIds: [...branchIds],
  };
};

/** A member outside the action's reach is not_found, never forbidden: members can't be probed. */
function visible(db: MockState, a: SchedulingAccess, id: string): MembershipUser {
  const member = db.members.find((m) => m.clinicId === a.clinic.id && m.id === id);
  if (!member || !providerWithin(a.reach, member)) throw new ApiError("not_found");
  return member;
}

function bookable(db: MockState, a: SchedulingAccess, id: string): MembershipUser {
  const member = visible(db, a, id);
  if (member.status !== "active" || !profileOf(db, id).acceptsAppointments) {
    throw new ApiError("provider_not_bookable");
  }
  return member;
}

/**
 * As the API: every row of the provider counts, dormant ones too (ADR-0026 §4); the conflicting
 * branch is named only inside the caller's view reach.
 */
function overlapCheck(
  a: SchedulingAccess,
  branchId: string,
  current: readonly StoredShift[],
  wanted: readonly WallShift[],
): void {
  const clash = findShiftOverlap(wanted)
    ? branchId
    : findShiftClash(
        current.filter((r) => r.branchId !== branchId),
        wanted,
      )?.branchId;
  if (clash === undefined) return;
  const details: Record<string, string> = reachCovers(a.viewReach, clash)
    ? { branchId: clash }
    : {};
  throw new ApiError("schedule_overlap", undefined, details);
}

const branchOf = ({ id, nameAr, nameEn, isActive }: ScheduleBranch) => ({
  id,
  nameAr,
  nameEn,
  isActive,
});

// Clipped to the caller's view keys, also when answering a write (as the API, Codex PR #63).
function scheduleOf(
  db: MockState,
  access: SchedulingAccess,
  member: MembershipUser,
): ProviderSchedule {
  const a = { ...access, reach: access.viewReach };
  const rows = db.scheduleRows.filter(
    (r) => r.clinicId === a.clinic.id && r.membershipId === member.id,
  );
  const reached = db.branches.filter(
    (b) => b.clinicId === a.clinic.id && reachCovers(a.reach, b.id),
  );
  const live = (b: ScheduleBranch) => b.isActive && worksIn(member, b.id);
  const branches = reached.filter(live);
  // Rows kept in an inactive branch or one the provider left: shown so they can be cleared.
  const dormant = reached.filter((b) => !live(b) && rows.some((r) => r.branchId === b.id));
  const ids = new Set([...branches, ...dormant].map((b) => b.id));
  const now = Date.now();
  return {
    provider: summary(db, a, member),
    branches: branches.map(branchOf),
    dormantBranches: dormant.map(branchOf),
    shifts: rows
      .filter((r) => ids.has(r.branchId))
      .sort((x, y) => x.weekday - y.weekday || x.startsAt.localeCompare(y.startsAt))
      .map(({ branchId, weekday, startsAt, endsAt }) => ({ branchId, weekday, startsAt, endsAt })),
    timeOff: db.timeOff
      .filter((t) => t.clinicId === a.clinic.id && t.membershipId === member.id)
      .filter((t) => t.cancelledAt === null && new Date(t.endsAt).getTime() > now)
      .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
      .map(({ id, startsAt, endsAt, note }) => ({ id, startsAt, endsAt, note })),
  };
}

// The note is free text about a person's absence: it never reaches an audit snapshot (ADR-0026 §7).
const offSnapshot = (t: StoredTimeOff, name: string) => ({
  id: t.id,
  providerName: name,
  startsAt: t.startsAt,
  endsAt: t.endsAt,
  cancelled: t.cancelledAt !== null,
});

export function createMockSchedules(): SchedulesApi {
  return {
    async listProviders(persona) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "view");
      return db.members
        .filter((m) => m.clinicId === a.clinic.id && m.status === "active")
        .filter((m) => profileOf(db, m.id).acceptsAppointments && providerWithin(a.reach, m))
        .sort((x, y) => x.fullName.localeCompare(y.fullName))
        .map((m) => summary(db, a, m));
    },
    async getProviderSchedule(persona, id) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "view");
      return scheduleOf(db, a, visible(db, a, id));
    },
    async replaceBranchSchedule(persona, id, branchId, rawInput) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "update");
      const parsed = branchScheduleInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const member = bookable(db, a, id);
      const branch = db.branches.find((b) => b.clinicId === a.clinic.id && b.id === branchId);
      if (!branch) throw new ApiError("not_found");
      if (!reachCovers(a.reach, branchId)) throw new ApiError("forbidden");
      // As the API: a dormant branch (inactive, or the provider left it) takes only an empty week.
      if (parsed.data.shifts.length > 0) {
        if (!branch.isActive) throw new ApiError("branch_inactive");
        if (!worksIn(member, branchId)) throw new ApiError("provider_not_in_branch");
      }
      const mineOf = (r: (typeof db.scheduleRows)[number]) =>
        r.clinicId === a.clinic.id && r.membershipId === id;
      const current = db.scheduleRows.filter(mineOf);
      const before = current
        .filter((r) => r.branchId === branchId)
        .map(shiftLabel)
        .sort();
      const after = parsed.data.shifts.map(shiftLabel).sort();
      if (before.join("|") !== after.join("|")) {
        overlapCheck(a, branchId, current, parsed.data.shifts);
        db.scheduleRows = db.scheduleRows
          .filter((r) => !(mineOf(r) && r.branchId === branchId))
          .concat(
            parsed.data.shifts.map((s) => ({
              ...s,
              id: newId(),
              clinicId: a.clinic.id,
              membershipId: id,
              branchId,
            })),
          );
        const base = { id, providerName: member.fullName, branchId };
        writeClinicAudit(db, {
          clinicId: a.clinic.id,
          actorName: a.actorName,
          action: "schedule.replaced",
          entity: "provider_schedule",
          before: { ...base, shifts: before },
          after: { ...base, shifts: after },
        });
        persist();
      }
      return scheduleOf(db, a, member);
    },
    async addTimeOff(persona, id, rawInput) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "update", true);
      const parsed = timeOffInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const member = bookable(db, a, id);
      const note = parsed.data.note?.trim() || null;
      const off: StoredTimeOff = {
        id: newId(),
        clinicId: a.clinic.id,
        membershipId: id,
        startsAt: new Date(parsed.data.startsAt).toISOString(),
        endsAt: new Date(parsed.data.endsAt).toISOString(),
        note,
        cancelledAt: null,
      };
      db.timeOff.push(off);
      writeClinicAudit(db, {
        clinicId: a.clinic.id,
        actorName: a.actorName,
        action: "time_off.added",
        entity: "provider_time_off",
        before: null,
        after: offSnapshot(off, member.fullName),
      });
      persist();
      return scheduleOf(db, a, member);
    },
    async cancelTimeOff(persona, id, timeOffId) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "update", true);
      const member = visible(db, a, id);
      const off = db.timeOff.find(
        (t) => t.clinicId === a.clinic.id && t.membershipId === id && t.id === timeOffId,
      );
      if (!off) throw new ApiError("not_found");
      if (off.cancelledAt === null) {
        const before = offSnapshot(off, member.fullName);
        off.cancelledAt = new Date().toISOString();
        writeClinicAudit(db, {
          clinicId: a.clinic.id,
          actorName: a.actorName,
          action: "time_off.cancelled",
          entity: "provider_time_off",
          before,
          after: offSnapshot(off, member.fullName),
        });
        persist();
      }
      return scheduleOf(db, a, member);
    },
  };
}
