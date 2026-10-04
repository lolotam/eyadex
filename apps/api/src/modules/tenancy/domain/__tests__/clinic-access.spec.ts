import { describe, expect, it } from "vitest";

import { decideClinicAccess } from "../clinic-access.ts";

const expiresAt = new Date("2026-11-01T00:00:00.000Z");
const before = new Date(expiresAt.getTime() - 1);
const after = new Date(expiresAt.getTime() + 1);

describe("decideClinicAccess", () => {
  it("allows trial and active clinics before expiry", () => {
    expect(decideClinicAccess({ status: "trial", expiresAt }, before)).toBe("allowed");
    expect(decideClinicAccess({ status: "active", expiresAt }, before)).toBe("allowed");
  });

  it("is expired exactly at the expires_at instant (exclusive)", () => {
    expect(decideClinicAccess({ status: "active", expiresAt }, new Date(expiresAt))).toBe(
      "expired",
    );
    expect(decideClinicAccess({ status: "trial", expiresAt }, new Date(expiresAt))).toBe("expired");
  });

  it("is expired after expires_at", () => {
    expect(decideClinicAccess({ status: "active", expiresAt }, after)).toBe("expired");
  });

  it("suspended wins before and after expiry", () => {
    expect(decideClinicAccess({ status: "suspended", expiresAt }, before)).toBe("suspended");
    expect(decideClinicAccess({ status: "suspended", expiresAt }, after)).toBe("suspended");
  });
});
