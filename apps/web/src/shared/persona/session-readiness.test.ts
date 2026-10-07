import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { isSessionLoadFailure, isSessionReady } from "./session-readiness";

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

describe("isSessionLoadFailure", () => {
  it("is a failure when the first read fails for a reason no layout handles", () => {
    expect(isSessionLoadFailure(new ApiError("unknown"), false)).toBe(true);
    expect(isSessionLoadFailure(new TypeError("network"), false)).toBe(true);
  });
  it("is not one while loading, after a failed refresh, or for an answer a layout handles", () => {
    expect(isSessionLoadFailure(null, false)).toBe(false);
    expect(isSessionLoadFailure(new ApiError("unknown"), true)).toBe(false);
    for (const code of ["unauthorized", "two_factor_required", "subscription_blocked"] as const) {
      expect(isSessionLoadFailure(new ApiError(code), false)).toBe(false);
    }
  });
});
