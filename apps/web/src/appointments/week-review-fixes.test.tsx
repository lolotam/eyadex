import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppointmentWeek } from "@eyadex/contracts/appointment-calendar";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { gutterDayIndex, pickedProvider, weekDayIndexOf, weekDialogDay } from "./calendar-dates";
import { dayLength } from "./day-grid";
import { ProviderColumn } from "./provider-column";

// Codex A4 review on PR #67: a week column stops at its own day and reads its own clock, the week's
// dialog offers the branch's providers, and the month's provider filter never outlives its branch.
afterEach(() => cleanup());

const noop = () => undefined;
const LONDON_SPRING = "2027-03-28"; // clocks go forward at 01:00: a 23-hour day

function dayOf(date: string, timezone: string): AppointmentDay {
  return {
    branch: { id: "b1", nameAr: "فرع", nameEn: "Branch", isActive: true },
    date,
    timezone,
    providers: [
      {
        membershipId: "m1",
        fullName: "Dr. Test",
        defaultDurationMinutes: 20,
        bookable: true,
        shifts: [],
        timeOff: [],
      },
    ],
    appointments: [],
    can: { create: true, update: true, overbook: false },
  };
}

describe("a week column on a clock-change day", () => {
  it("offers no slot past its own day when the week's shared range is longer", () => {
    const day = dayOf(LONDON_SPRING, "Europe/London");
    expect(dayLength(day.date, day.timezone)).toBe(23 * 60);
    render(
      <I18nProvider>
        <ProviderColumn
          day={day}
          provider={day.providers[0]!}
          range={{ from: 0, to: 24 * 60 }}
          title="Sun 28"
          onBook={noop}
          onReschedule={noop}
          onCancel={noop}
        />
      </I18nProvider>,
    );
    // 23 hours of half-hour slots, not the 48 of the shared 24-hour range.
    expect(screen.getAllByRole("button")).toHaveLength(46);
  });
});

describe("the month's provider filter", () => {
  const listed = [{ membershipId: "m1" }, { membershipId: "m2" }];

  it("applies in the branch it was picked in while the list offers it", () => {
    expect(pickedProvider({ branchId: "b1", providerId: "m1" }, "b1", listed)).toBe("m1");
    expect(pickedProvider({ branchId: "b1", providerId: "m1" }, "b1", undefined)).toBe("m1");
  });

  it("falls back to every provider in another branch or when the list no longer offers it", () => {
    expect(pickedProvider({ branchId: "b1", providerId: "m1" }, "b2", listed)).toBeNull();
    expect(pickedProvider({ branchId: "b1", providerId: "m9" }, "b1", listed)).toBeNull();
    expect(pickedProvider(null, "b1", listed)).toBeNull();
  });
});

function weekFrom(weekStart: string, timezone: string): AppointmentWeek {
  const day = dayOf(weekStart, timezone);
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${weekStart}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
  );
  return {
    branch: day.branch,
    weekStart,
    timezone,
    provider: {
      membershipId: "m1",
      fullName: "Dr. Test",
      defaultDurationMinutes: 20,
      bookable: true,
    },
    days: dates.map((date) => ({ date, shifts: [], timeOff: [] })),
    appointments: [],
    can: day.can,
  };
}

describe("the week's clock", () => {
  it("reads the gutter from a regular day, skipping a clock-change first day", () => {
    expect(gutterDayIndex(weekFrom(LONDON_SPRING, "Europe/London"))).toBe(1);
    expect(gutterDayIndex(weekFrom("2027-03-07", "Asia/Kuwait"))).toBe(0);
  });

  it("a clock-change column labels its own hours", () => {
    const day = dayOf(LONDON_SPRING, "Europe/London");
    const column = (ownClock: boolean) =>
      render(
        <I18nProvider>
          <ProviderColumn
            day={day}
            provider={day.providers[0]!}
            range={{ from: 480, to: 1200 }}
            title="Sun 28"
            ownClock={ownClock}
            onBook={noop}
            onReschedule={noop}
            onCancel={noop}
          />
        </I18nProvider>,
      );
    column(false);
    expect(screen.queryByText("10:00")).toBeNull();
    cleanup();
    column(true);
    // Real minute 540 of that day is 10:00 on the clock (01:00 was skipped).
    expect(screen.getByText("10:00")).toBeTruthy();
  });
});

describe("the booking dialog opened from the week", () => {
  const week = weekFrom("2027-03-07", "Asia/Kuwait");
  const other = { ...dayOf("2027-03-07", "Asia/Kuwait").providers[0]!, membershipId: "m2" };

  it("opens on the day the appointment starts", () => {
    expect(weekDayIndexOf(week, "2027-03-08T06:00:00.000Z")).toBe(1); // Monday 09:00 in Kuwait
    expect(weekDayIndexOf(week, "2027-03-01T06:00:00.000Z")).toBe(0);
  });

  it("offers the branch's providers, falling back to the week's own", () => {
    const listed = [dayOf("2027-03-07", "Asia/Kuwait").providers[0]!, other];
    expect(weekDialogDay(week, 1, listed).providers.map((p) => p.membershipId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(weekDialogDay(week, 1, []).providers.map((p) => p.membershipId)).toEqual(["m1"]);
  });
});
