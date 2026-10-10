import { describe, expect, it } from "vitest";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import {
  hourMarks,
  labelAt,
  lanes,
  minuteOfDay,
  placement,
  PX_PER_MINUTE,
  shiftDate,
  shiftSegments,
  slotStarts,
  visibleRange,
  wallRuns,
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
    expect(hourMarks({ from: 480, to: 600 }, DATE, TZ).map((m) => m.label)).toEqual([
      "08:00",
      "09:00",
    ]);
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

  it("Codex A2 r2: a block across a repeated hour keeps its order and stays on the grid", () => {
    const start = minuteOfDay("2027-10-28T20:50:00.000Z", "2027-10-28", "Africa/Cairo");
    const end = minuteOfDay("2027-10-28T21:10:00.000Z", "2027-10-28", "Africa/Cairo");
    expect(end - start).toBe(20);
    expect(placement(start, end, { from: 0, to: 1500 })).not.toBeNull();
  });

  it("Codex A2 r3: the longer fall-back day shows its last hour, labelled on the clinic's clock", () => {
    const CAIRO = "Africa/Cairo";
    const late = {
      id: "x",
      branchId: "b",
      providerMembershipId: "m",
      providerName: "Dr",
      patientId: "p",
      patientName: "P",
      patientFileNumber: 1,
      serviceId: null,
      serviceNameAr: null,
      serviceNameEn: null,
      startsAt: "2027-10-28T21:30:00.000Z",
      endsAt: "2027-10-28T21:50:00.000Z",
      status: "booked" as const,
      overbooked: false,
      cancelReason: null,
      cancelNote: null,
    };
    const fallDay = day({ date: "2027-10-28", timezone: CAIRO, appointments: [late] });
    const range = visibleRange(fallDay);
    const start = minuteOfDay(late.startsAt, fallDay.date, CAIRO);
    expect(range.to).toBe(1500);
    expect(placement(start, start + 20, range)).not.toBeNull();
    expect(labelAt(1440, fallDay.date, CAIRO)).toBe("23:00");
    expect(labelAt(540, fallDay.date, CAIRO)).toBe("09:00");
  });

  describe("Codex PR #64 gh3: a wall-time shift covers every real minute that reads inside it", () => {
    const LONDON = "Europe/London";
    const withShift = (date: string, timezone: string, startsAt: string, endsAt: string) =>
      day({
        date,
        timezone,
        providers: [
          {
            membershipId: "m",
            fullName: "Dr",
            defaultDurationMinutes: 20,
            bookable: true,
            shifts: [{ startsAt, endsAt }],
            timeOff: [],
          },
        ],
      });
    const segments = (date: string, timezone: string, startsAt: string, endsAt: string) =>
      shiftSegments({ startsAt, endsAt }, wallRuns(date, timezone));

    it("widens the grid to the first 01:00 of a fall-back day, and not for a skipped hour", () => {
      expect(visibleRange(withShift("2027-10-31", LONDON, "01:00", "02:00")).from).toBe(60);
      expect(visibleRange(withShift("2027-03-28", LONDON, "01:00", "02:00"))).toEqual(
        visibleRange(day({ date: "2027-03-28", timezone: LONDON })),
      );
      expect(visibleRange(withShift(DATE, TZ, "06:15", "13:00"))).toEqual({ from: 360, to: 1200 });
    });

    it("covers both real hours of a repeated hour and none of a skipped one", () => {
      expect(segments("2027-10-31", LONDON, "01:00", "02:00")).toEqual([{ from: 60, to: 180 }]);
      // 01:30–02:00 summer time is not in 00:30–01:30, so the shift splits around it.
      expect(segments("2027-10-31", LONDON, "00:30", "01:30")).toEqual([
        { from: 30, to: 90 },
        { from: 120, to: 150 },
      ]);
      expect(segments("2027-03-28", LONDON, "01:00", "02:00")).toEqual([]);
      expect(segments("2027-03-28", LONDON, "00:30", "03:00")).toEqual([{ from: 30, to: 120 }]);
    });

    it("leaves a normal day and a Kuwait day as they were", () => {
      expect(segments("2027-06-15", LONDON, "09:00", "17:00")).toEqual([{ from: 540, to: 1020 }]);
      expect(segments(DATE, TZ, "07:30", "24:00")).toEqual([{ from: 450, to: 1440 }]);
    });
  });
});
