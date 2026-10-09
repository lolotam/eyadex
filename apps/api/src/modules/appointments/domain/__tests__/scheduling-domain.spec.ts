import { describe, expect, it } from "vitest";

import {
  decideBranchSchedule,
  scheduleAuditSnapshot,
  wallFromDb,
  type ScheduleRow,
} from "../schedule-rules.ts";
import {
  providerWithin,
  providerWorksIn,
  reachCovers,
  reachOf,
  type Reach,
} from "../scheduling-scope.ts";
import { isServiceUnchanged, serviceAuditSnapshot, type ServiceRecord } from "../service-rules.ts";
import {
  decideTimeOffCancel,
  normalizeNote,
  timeOffAuditSnapshot,
  type TimeOffRecord,
} from "../time-off-rules.ts";

const MINE: Reach = { all: false, branchIds: ["r"] };
const LIVE = () => true;
const row = (branchId: string, weekday: number, startsAt: string, endsAt: string): ScheduleRow => ({
  id: `${branchId}${weekday}${startsAt}`,
  branchId,
  weekday,
  startsAt,
  endsAt,
});

describe("reach of a route's grant", () => {
  it("clinic = every branch, branch = the member's branches, own or nothing = no reach", () => {
    expect(reachOf("clinic", MINE)).toEqual({ all: true });
    expect(reachOf("branch", MINE)).toEqual(MINE);
    expect(reachOf("branch", { all: true })).toEqual({ all: true });
    expect(reachOf("own", MINE)).toBeNull();
    expect(reachOf(undefined, MINE)).toBeNull();
  });

  it("a provider is within reach when it works in one of the reached branches", () => {
    expect(reachCovers(MINE, "r")).toBe(true);
    expect(reachCovers(MINE, "d")).toBe(false);
    expect(providerWithin(MINE, { allBranches: false, branchIds: ["d", "r"] })).toBe(true);
    expect(providerWithin(MINE, { allBranches: false, branchIds: ["d"] })).toBe(false);
    expect(providerWithin(MINE, { allBranches: true, branchIds: [] })).toBe(true);
    expect(providerWorksIn({ allBranches: false, branchIds: ["d"] }, "r")).toBe(false);
  });
});

describe("decideBranchSchedule (D-6, D-13)", () => {
  const current = [row("d", 0, "08:00", "12:00"), row("r", 1, "08:00", "12:00")];

  it("the same week in the same branch changes nothing, in any order", () => {
    const same = [{ weekday: 0, startsAt: "08:00", endsAt: "12:00" }];
    expect(decideBranchSchedule(current, "d", same, LIVE)).toEqual({ kind: "same" });
  });

  it("refuses a week that overlaps the provider's rows in another branch", () => {
    const clash = [{ weekday: 1, startsAt: "11:00", endsAt: "13:00" }];
    expect(decideBranchSchedule(current, "d", clash, LIVE)).toEqual({ kind: "overlap" });
  });

  it("rows of a branch the provider left, or of an inactive branch, are dormant (Codex r1)", () => {
    const clash = [{ weekday: 1, startsAt: "11:00", endsAt: "13:00" }];
    expect(decideBranchSchedule(current, "d", clash, (id) => id !== "r")).toEqual({
      kind: "replace",
      shifts: clash,
    });
  });

  it("refuses two wanted rows that overlap each other", () => {
    const self = [
      { weekday: 3, startsAt: "08:00", endsAt: "10:00" },
      { weekday: 3, startsAt: "09:30", endsAt: "11:00" },
    ];
    expect(decideBranchSchedule([], "d", self, LIVE)).toEqual({ kind: "overlap" });
  });

  it("replaces with back-to-back rows across midnight (D-14) and drops the branch's old rows", () => {
    const night = [
      { weekday: 1, startsAt: "00:00", endsAt: "01:00" },
      { weekday: 0, startsAt: "20:00", endsAt: "24:00" },
    ];
    expect(decideBranchSchedule(current, "d", night, LIVE)).toEqual({
      kind: "replace",
      shifts: [night[1], night[0]],
    });
    expect(decideBranchSchedule(current, "d", [], LIVE)).toEqual({ kind: "replace", shifts: [] });
  });

  it("reads PostgreSQL time text as HH:MM, 24:00 included", () => {
    expect(wallFromDb("08:30:00")).toBe("08:30");
    expect(wallFromDb("24:00:00")).toBe("24:00");
  });
});

describe("audit snapshots (allowlisted, scrubbed)", () => {
  it("a schedule snapshot names the provider and lists the rows as text", () => {
    const shifts = [{ weekday: 0, startsAt: "08:00", endsAt: "12:00" }];
    expect(scheduleAuditSnapshot("Dr 99998888", "d", shifts)).toEqual({
      providerName: expect.not.stringContaining("99998888"),
      branchId: "d",
      shifts: ["0 08:00-12:00"],
    });
  });

  it("a service is unchanged only when all three fields match; its snapshot has four fields", () => {
    const s: ServiceRecord = {
      id: "s",
      nameAr: "ليزر",
      nameEn: "Laser",
      durationMinutes: 30,
      status: "active",
    };
    expect(isServiceUnchanged(s, { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 30 })).toBe(
      true,
    );
    expect(isServiceUnchanged(s, { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 45 })).toBe(
      false,
    );
    expect(Object.keys(serviceAuditSnapshot(s)).sort()).toEqual([
      "durationMinutes",
      "nameAr",
      "nameEn",
      "status",
    ]);
  });

  it("time off: a blank note is no note, a second cancel changes nothing, the note never reaches audit", () => {
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(" leave ")).toBe("leave");
    const off: TimeOffRecord = {
      id: "t",
      startsAt: new Date("2026-10-11T06:00:00Z"),
      endsAt: new Date("2026-10-12T06:00:00Z"),
      note: "medical",
      cancelledAt: null,
    };
    expect(decideTimeOffCancel(off)).toBe("cancel");
    expect(decideTimeOffCancel({ ...off, cancelledAt: new Date() })).toBe("same");
    expect(timeOffAuditSnapshot("Dr A", off)).toEqual({
      providerName: "Dr A",
      startsAt: "2026-10-11T06:00:00.000Z",
      endsAt: "2026-10-12T06:00:00.000Z",
      cancelled: false,
    });
  });
});
