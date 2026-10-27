import { describe, expect, it } from "vitest";

import { branchScheduleInputSchema } from "../schedules.ts";

// GHSA-mrhx-c7xc-m3w5: the production week array must refuse on size before reading an element.
// The counter is a property trap on the input, not a Zod mock or a stand-in schema.
function countedWeek(count: number, invalidAt?: number) {
  let visits = 0;
  const shifts = Array.from({ length: count }, (_, index) => {
    const row = {
      weekday: 1,
      startsAt: index === invalidAt ? "99:99" : "09:00",
      endsAt: "17:00",
    };
    return new Proxy(row, {
      get(target, prop, receiver) {
        if (prop === "weekday" || prop === "startsAt" || prop === "endsAt") visits += 1;
        return Reflect.get(target, prop, receiver);
      },
    });
  });
  return { body: { shifts }, visits: () => visits };
}

const VALID_SHIFT = { weekday: 1, startsAt: "09:00", endsAt: "17:00" };

describe("branchScheduleInputSchema array cap", () => {
  it("refuses 43 valid shifts without reading an element", () => {
    const counted = countedWeek(43);
    const result = branchScheduleInputSchema.safeParse(counted.body);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ code: "too_big", path: ["shifts"] }),
      ]);
    }
    expect(counted.visits()).toBe(0);
  });

  it("walks and returns a week that sits on the bound of 42", () => {
    const counted = countedWeek(42);
    const parsed = branchScheduleInputSchema.parse(counted.body);

    expect(parsed.shifts).toEqual(Array.from({ length: 42 }, () => VALID_SHIFT));
    expect(counted.visits()).toBeGreaterThanOrEqual(42);
  });

  it("still rejects invalid shift data under the bound", () => {
    const counted = countedWeek(1, 0);
    const result = branchScheduleInputSchema.safeParse(counted.body);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "too_big")).toBe(false);
    }
    expect(counted.visits()).toBeGreaterThan(0);
  });
});
