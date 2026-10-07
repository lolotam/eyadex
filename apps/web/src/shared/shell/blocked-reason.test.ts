import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { blockedReasonOf } from "./blocked-reason";

describe("blockedReasonOf", () => {
  it("tells a suspended clinic apart from an expired one", () => {
    const suspended = new ApiError("subscription_blocked", undefined, { reason: "suspended" });
    const expired = new ApiError("subscription_blocked", undefined, { reason: "expired" });
    expect(blockedReasonOf(suspended)).toBe("suspended");
    expect(blockedReasonOf(expired)).toBe("expired");
    expect(blockedReasonOf(new Error("x"))).toBe("expired");
  });
});
