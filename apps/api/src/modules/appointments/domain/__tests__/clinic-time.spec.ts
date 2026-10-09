import { instantToWall, wallToInstant } from "@eyadex/contracts/clinic-time";
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
