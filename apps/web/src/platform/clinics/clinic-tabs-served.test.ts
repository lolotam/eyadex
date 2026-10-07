import { describe, expect, it } from "vitest";
import { isClinicTabServed } from "./clinic-tabs-served";

describe("isClinicTabServed", () => {
  it("serves every tab against the mock", () => {
    expect(isClinicTabServed("details", "mock")).toBe(true);
    expect(isClinicTabServed("users", "mock")).toBe(true);
  });
  it("against the API, never shows an editable details form or an empty members list", () => {
    expect(isClinicTabServed("details", "http")).toBe(false);
    expect(isClinicTabServed("users", "http")).toBe(false);
    expect(isClinicTabServed("subscription", "http")).toBe(true);
    expect(isClinicTabServed("modules", "http")).toBe(true);
    expect(isClinicTabServed("branches", "http")).toBe(true);
  });
});
