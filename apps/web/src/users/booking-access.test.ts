import { describe, expect, it } from "vitest";
import { mayEditBooking } from "./booking-access";

const on = { patients: true, appointments: true };
const off = { patients: true, appointments: false };

describe("booking settings on the user editor", () => {
  it("need update:users and the appointments module — permissions only, never a role", () => {
    expect(mayEditBooking({ permissions: ["update:users:clinic"], features: on })).toBe(true);
    expect(mayEditBooking({ permissions: ["update:users:clinic"], features: off })).toBe(false);
    expect(mayEditBooking({ permissions: ["view:users:clinic"], features: on })).toBe(false);
  });
});
