import { describe, expect, it } from "vitest";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import {
  hourMarks,
  lanes,
  minuteOfDay,
  placement,
  PX_PER_MINUTE,
  shiftDate,
  slotStarts,
  visibleRange,
} from "./day-grid";

const TZ = "Asia/Kuwait";
const DATE = "2027-03-07";
const day = (over: Partial<AppointmentDay> = {}): AppointmentDay => ({
  branch: { id: "b", nameAr: "ف", nameEn: "B", isActive: true },
  date: DATE,
  timezone: TZ,
  providers: [],
  appointments: [],
  can: { create: true, update: true, overbook: false },
  ...over,
});

describe("the branch day grid", () => {
  it("places an instant in minutes after the clinic's midnight, also across midnight", () => {
    expect(minuteOfDay(wallToInstant(DATE, "09:30", TZ), DATE, TZ)).toBe(570);
    expect(minuteOfDay(wallToInstant("2027-03-08", "00:15", TZ), DATE, TZ)).toBe(1455);
    expect(minuteOfDay(wallToInstant("2027-03-06", "23:00", TZ), DATE, TZ)).toBe(-60);
  });

  it("shows 08:00–20:00, widened to the shifts in whole hours", () => {
    expect(visibleRange(day())).toEqual({ from: 480, to: 1200 });
    const providers = [
      {
        membershipId: "m",
        fullName: "Dr",
        defaultDurationMinutes: 20,
        bookable: true,
        shifts: [{ startsAt: "07:30", endsAt: "24:00" }],
        timeOff: [],
      },
    ];
    expect(visibleRange(day({ providers }))).toEqual({ from: 420, to: 1440 });
  });

  it("clips a block to the range and drops one outside it", () => {
    const range = { from: 480, to: 1200 };
    expect(placement(540, 570, range)).toEqual({
      top: 60 * PX_PER_MINUTE,
      height: 30 * PX_PER_MINUTE,
    });
    expect(placement(450, 500, range)).toEqual({ top: 0, height: 20 * PX_PER_MINUTE });
    expect(placement(1200, 1260, range)).toBeNull();
  });

  it("offers half-hour slots and hourly marks; moves the date by days", () => {
    expect(slotStarts({ from: 480, to: 600 })).toEqual([480, 510, 540, 570]);
    expect(hourMarks({ from: 480, to: 600 }).map((m) => m.label)).toEqual(["08:00", "09:00"]);
    expect(shiftDate(DATE, 1)).toBe("2027-03-08");
    expect(shiftDate(DATE, -7)).toBe("2027-02-28");
  });

  it("puts overlapping blocks side by side and the rest in one lane", () => {
    const span = (id: string, from: string, to: string) => ({
      id,
      startsAt: wallToInstant(DATE, from, TZ),
      endsAt: wallToInstant(DATE, to, TZ),
    });
    const placed = lanes([
      span("a", "09:00", "09:30"),
      span("b", "09:10", "09:20"),
      span("c", "09:30", "10:00"),
    ]);
    expect(placed.get("a")).toEqual({ lane: 0, of: 2 });
    expect(placed.get("b")).toEqual({ lane: 1, of: 2 });
    expect(placed.get("c")).toEqual({ lane: 0, of: 1 });
  });
});
