import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppointmentDay } from "@eyadex/contracts/appointments";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { pickedProvider } from "./calendar-dates";
import { dayLength } from "./day-grid";
import { ProviderColumn } from "./provider-column";

// Codex A4 review on PR #67: a week column stops at its own day, and the month's provider filter never
// outlives the branch it was picked in.
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
