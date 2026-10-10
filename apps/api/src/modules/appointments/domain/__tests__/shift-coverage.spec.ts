import { coversWallInterval, findShiftOverlap, type WallShift } from "@eyadex/contracts/schedules";
import { describe, expect, it } from "vitest";

const SUN = 0;
const MON = 1;
const SAT = 6;
const shift = (weekday: number, startsAt: string, endsAt: string): WallShift => ({
  weekday,
  startsAt,
  endsAt,
});
const at = (weekday: number, time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return { weekday, minute: h * 60 + m };
};

describe("findShiftOverlap (a provider is in one place at a time)", () => {
  it("touching ends are not an overlap; a shared minute is", () => {
    expect(
      findShiftOverlap([shift(SUN, "08:00", "12:00"), shift(SUN, "12:00", "16:00")]),
    ).toBeNull();
    const clash = [shift(SUN, "08:00", "12:00"), shift(SUN, "11:59", "13:00")];
    expect(findShiftOverlap(clash)).toEqual(clash);
  });

  it("finds a short shift inside a long one even with a later shift between them", () => {
    const rows = [
      shift(MON, "08:00", "20:00"),
      shift(MON, "09:00", "10:00"),
      shift(MON, "21:00", "22:00"),
    ];
    expect(findShiftOverlap(rows)).toEqual([rows[0], rows[1]]);
  });

  it("Sunday 20:00–24:00 and Monday 00:00–01:00 do not overlap", () => {
    expect(
      findShiftOverlap([shift(SUN, "20:00", "24:00"), shift(MON, "00:00", "01:00")]),
    ).toBeNull();
  });
});

describe("coversWallInterval (D-6, D-14)", () => {
  const split = [shift(SUN, "08:00", "12:00"), shift(SUN, "16:00", "20:00")];

  it("split shifts: inside one part yes, across the gap no", () => {
    expect(coversWallInterval(split, at(SUN, "16:00"), 30)).toBe(true);
    expect(coversWallInterval(split, at(SUN, "11:30"), 60)).toBe(false);
  });

  it("a shift continued across midnight covers 23:45–00:15", () => {
    const night = [shift(SUN, "20:00", "24:00"), shift(MON, "00:00", "01:00")];
    expect(coversWallInterval(night, at(SUN, "23:45"), 30)).toBe(true);
  });

  it("a gap at midnight is not covered", () => {
    const gap = [shift(SUN, "20:00", "23:30"), shift(MON, "00:00", "01:00")];
    expect(coversWallInterval(gap, at(SUN, "23:45"), 30)).toBe(false);
  });

  it("Saturday 24:00 continues into Sunday 00:00, from either side of the week", () => {
    const weekEnd = [shift(SAT, "22:00", "24:00"), shift(SUN, "00:00", "02:00")];
    expect(coversWallInterval(weekEnd, at(SAT, "23:30"), 60)).toBe(true);
    expect(coversWallInterval(weekEnd, at(SUN, "00:10"), 30)).toBe(true);
    expect(coversWallInterval(weekEnd, at(SUN, "01:30"), 60)).toBe(false);
  });

  it("no shift that day covers nothing", () => {
    expect(coversWallInterval(split, at(MON, "09:00"), 15)).toBe(false);
  });
});

describe("a week open around the clock (Codex r3)", () => {
  it("Saturday 23:45 for 30 minutes runs into Sunday", () => {
    const always = [0, 1, 2, 3, 4, 5, 6].map((day) => shift(day, "00:00", "24:00"));
    expect(coversWallInterval(always, at(SAT, "23:45"), 30)).toBe(true);
  });
});
