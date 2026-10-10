import {
  clinicDayBounds,
  instantToWall,
  wallTimeExists,
  wallToInstant,
} from "@eyadex/contracts/clinic-time";
import { describe, expect, it } from "vitest";

describe("clinic wall time", () => {
  it("Kuwait wall time is UTC+3 all year", () => {
    expect(wallToInstant("2026-10-11", "09:00", "Asia/Kuwait")).toBe("2026-10-11T06:00:00.000Z");
    expect(wallToInstant("2026-10-11", "00:30", "Asia/Kuwait")).toBe("2026-10-10T21:30:00.000Z");
  });

  it("round-trips an instant through the clinic's wall clock", () => {
    const iso = "2026-10-10T21:30:00.000Z";
    expect(instantToWall(iso, "Asia/Kuwait")).toEqual({ date: "2026-10-11", time: "00:30" });
    const { date, time } = instantToWall(iso, "Africa/Cairo");
    expect(wallToInstant(date, time, "Africa/Cairo")).toBe(iso);
  });
});

describe("a wall time a clock change skips (Codex r2)", () => {
  it("does not exist, so it is refused instead of silently moved", () => {
    // Egypt springs forward at 00:00 on 24 April 2026: 00:30 that night never happens.
    expect(wallTimeExists("2026-04-24", "00:30", "Africa/Cairo")).toBe(false);
    expect(wallTimeExists("2026-04-24", "01:30", "Africa/Cairo")).toBe(true);
    expect(wallTimeExists("2026-10-11", "00:30", "Asia/Kuwait")).toBe(true);
  });
});

describe("the clinic day starts at its first real instant (ADR-0026 A3)", () => {
  const minutes = (date: string, zone: string) => {
    const day = clinicDayBounds(date, zone);
    return (Date.parse(day.endsAt) - Date.parse(day.startsAt)) / 60_000;
  };
  const firstWall = (date: string, zone: string) =>
    instantToWall(clinicDayBounds(date, zone).startsAt, zone);

  it("Cairo's spring day starts at 01:00 and lasts 23 hours; the day before stays whole", () => {
    // Egypt springs forward from 00:00 to 01:00 on the last Friday of April.
    expect(firstWall("2027-04-30", "Africa/Cairo")).toEqual({ date: "2027-04-30", time: "01:00" });
    expect(minutes("2027-04-30", "Africa/Cairo")).toBe(1380);
    expect(minutes("2027-04-29", "Africa/Cairo")).toBe(1440);
  });

  it("Cairo falls back at the end of Thursday: that day lasts 25 hours, Friday 24", () => {
    expect(minutes("2027-10-28", "Africa/Cairo")).toBe(1500);
    expect(minutes("2027-10-29", "Africa/Cairo")).toBe(1440);
    expect(firstWall("2027-10-29", "Africa/Cairo")).toEqual({ date: "2027-10-29", time: "00:00" });
  });

  it("a zone west of UTC that skips midnight starts the day at the change, not the evening before", () => {
    // Havana, Santiago and the Azores spring from 00:00 to 01:00; wallToInstant(date, "00:00") lands an
    // hour before the change, on the previous date.
    for (const [date, zone] of [
      ["2027-03-14", "America/Havana"],
      ["2027-09-05", "America/Santiago"],
      ["2027-03-28", "Atlantic/Azores"],
    ] as const) {
      expect(firstWall(date, zone)).toEqual({ date, time: "01:00" });
      expect(minutes(date, zone)).toBe(1380);
    }
    expect(minutes("2027-03-13", "America/Havana")).toBe(1440);
  });

  it("a zone that repeats midnight starts the day at the earlier reading", () => {
    // Havana falls back from 01:00 to 00:00 on 7 November 2027: 00:00 reads twice, 04:00Z and 05:00Z.
    const day = clinicDayBounds("2027-11-07", "America/Havana");
    expect(day.startsAt).toBe("2027-11-07T04:00:00.000Z");
    expect(instantToWall("2027-11-07T05:00:00.000Z", "America/Havana")).toEqual({
      date: "2027-11-07",
      time: "00:00",
    });
    expect(minutes("2027-11-07", "America/Havana")).toBe(1500);
    expect(clinicDayBounds("2027-11-06", "America/Havana").endsAt).toBe(day.startsAt);
  });

  it("Kuwait (no daylight saving) has 1440 minutes every day of the year", () => {
    for (let d = Date.UTC(2027, 0, 1); d < Date.UTC(2028, 0, 1); d += 86_400_000) {
      expect(minutes(new Date(d).toISOString().slice(0, 10), "Asia/Kuwait")).toBe(1440);
    }
  });
});
