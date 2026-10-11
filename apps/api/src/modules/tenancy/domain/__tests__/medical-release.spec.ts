import type { PlatformSettings } from "@eyadex/contracts/platform";
import { describe, expect, it } from "vitest";

import { medicalDefaultAllowed } from "../medical-release.ts";

const settings = (medical: boolean): PlatformSettings => ({
  defaultTrialDays: 14,
  alertDaysBeforeExpiry: 7,
  emailSenderName: "Eyadex",
  defaultMaxUsers: 10,
  defaultMaxBranches: 3,
  defaultModules: { patients: true, appointments: true, medical },
});

describe("medicalDefaultAllowed (P2 R3-6c)", () => {
  it("refuses turning the medical default on before the release, and allows it after", () => {
    expect(medicalDefaultAllowed(false, settings(true))).toBe(false);
    expect(medicalDefaultAllowed(true, settings(true))).toBe(true);
  });

  it("always allows the medical default off", () => {
    expect(medicalDefaultAllowed(false, settings(false))).toBe(true);
    expect(medicalDefaultAllowed(true, settings(false))).toBe(true);
  });
});
