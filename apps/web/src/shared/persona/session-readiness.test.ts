import { describe, expect, it } from "vitest";
import { isSessionReady } from "./session-readiness";

describe("isSessionReady", () => {
  it("waits until the area is known", () => {
    expect(isSessionReady(undefined, false)).toBe(false);
  });
  it("is ready at once on the marketing host, where no session is read", () => {
    expect(isSessionReady(null, false)).toBe(true);
  });
  it("inside an area, needs a session", () => {
    expect(isSessionReady("clinic", false)).toBe(false);
    expect(isSessionReady("platform", true)).toBe(true);
  });
});
