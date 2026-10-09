import { describe, expect, it } from "vitest";
import type { ProviderSchedule } from "@eyadex/contracts/schedules";
import { ApiError } from "@/shared/api/api-error";
import {
  clashBranch,
  rowsForBranch,
  skippedTimeField,
  toTimeOffInput,
  toWeekInput,
  wallLabel,
} from "./schedule-forms";

const schedule: ProviderSchedule = {
  provider: {
    membershipId: "0190a000-0000-7000-8000-000000000001",
    fullName: "Dr A",
    defaultDurationMinutes: 20,
    allBranches: true,
    branchIds: [],
  },
  branches: [{ id: "a", nameAr: "أ", nameEn: "A", isActive: true }],
  dormantBranches: [{ id: "b", nameAr: "ب", nameEn: "B", isActive: false }],
  shifts: [
    { branchId: "b", weekday: 1, startsAt: "00:00", endsAt: "01:00" },
    { branchId: "a", weekday: 0, startsAt: "09:00", endsAt: "13:00" },
    { branchId: "b", weekday: 0, startsAt: "20:00", endsAt: "24:00" },
  ],
  timeOff: [],
};

describe("schedule form helpers", () => {
  it("one branch's rows, in week order, keyed for React", () => {
    const rows = rowsForBranch(schedule, "b");
    expect(rows.map((r) => [r.weekday, r.startsAt, r.endsAt])).toEqual([
      [0, "20:00", "24:00"],
      [1, "00:00", "01:00"],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("sends the rows without their keys", () => {
    expect(toWeekInput(rowsForBranch(schedule, "a"))).toEqual({
      shifts: [{ weekday: 0, startsAt: "09:00", endsAt: "13:00" }],
    });
  });

  it("time off typed in clinic wall time becomes instants; a blank note is null", () => {
    const form = {
      startDate: "2026-10-11",
      startTime: "09:00",
      endDate: "2026-10-11",
      endTime: "13:00",
      note: "  ",
    };
    expect(toTimeOffInput(form, "Asia/Kuwait")).toEqual({
      startsAt: "2026-10-11T06:00:00.000Z",
      endsAt: "2026-10-11T10:00:00.000Z",
      note: null,
    });
    expect(wallLabel("2026-10-11T06:00:00.000Z", "Asia/Kuwait")).toBe("2026-10-11 09:00");
  });
});

describe("time off on a clock change (Codex r2)", () => {
  it("names the field whose wall time the clinic's zone skips", () => {
    const form = {
      startDate: "2026-04-24",
      startTime: "00:30",
      endDate: "2026-04-24",
      endTime: "09:00",
      note: "",
    };
    expect(skippedTimeField(form, "Africa/Cairo")).toBe("startTime");
    expect(skippedTimeField({ ...form, startTime: "02:00" }, "Africa/Cairo")).toBeNull();
  });

  it("names the other branch a refused week overlaps, live or dormant, when the API named it", () => {
    const overlap = (details: Record<string, string>) =>
      new ApiError("schedule_overlap", undefined, details);
    expect(clashBranch(schedule, "a", overlap({ branchId: "b" }))?.nameEn).toBe("B");
    expect(clashBranch(schedule, "b", overlap({ branchId: "a" }))?.nameEn).toBe("A");
    // Unnamed (outside the caller's reach), the branch itself, unknown or another error: generic.
    expect(clashBranch(schedule, "a", overlap({}))).toBeNull();
    expect(clashBranch(schedule, "a", overlap({ branchId: "a" }))).toBeNull();
    expect(clashBranch(schedule, "a", overlap({ branchId: "zz" }))).toBeNull();
    expect(clashBranch(schedule, "a", new ApiError("forbidden"))).toBeNull();
  });
});
