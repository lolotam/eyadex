import { describe, expect, it } from "vitest";

import { moduleDependencyGap } from "../onboarding.ts";
import { createClinicInputSchema } from "../clinics.ts";
import {
  platformSettingsRequestSchema,
  platformSettingsResponseSchema,
} from "../platform-console.ts";
import {
  DEFAULT_PLATFORM_SETTINGS,
  platformSettingsSchema,
  updatePlatformSettingsSchema,
} from "../platform.ts";

// P2-14: one table decides it for the create form, the platform default and the per-clinic switch.
describe("medical needs patients", () => {
  it.each([
    [{ patients: true, appointments: false, medical: true, finance: false }, null],
    [{ patients: false, appointments: true, medical: false, finance: false }, null],
    [
      { patients: false, appointments: false, medical: true, finance: false },
      { module: "medical", requires: "patients" },
    ],
  ])("%j → %j", (flags, gap) => {
    expect(moduleDependencyGap(flags)).toEqual(gap);
  });

  it("NEGATIVE: a platform default with medical but not patients is refused on the medical flag", () => {
    const result = updatePlatformSettingsSchema.safeParse({
      ...DEFAULT_PLATFORM_SETTINGS,
      defaultModules: { patients: false, appointments: true, medical: true, finance: false },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["defaultModules", "medical"], "validation.moduleRequires"],
    ]);
  });

  it("reads incoherent stored defaults, but refuses writing them", () => {
    const stored = {
      ...DEFAULT_PLATFORM_SETTINGS,
      defaultModules: { patients: false, appointments: true, medical: true, finance: false },
    };
    expect(platformSettingsSchema.parse(stored)).toEqual(stored);
    expect(platformSettingsResponseSchema.parse(stored)).toEqual(stored);
    expect(platformSettingsRequestSchema.safeParse(stored).success).toBe(false);
  });

  it("NEGATIVE: the create form refuses medical without patients", () => {
    const result = createClinicInputSchema.safeParse({
      nameAr: "عيادة",
      nameEn: "Clinic",
      slug: "test-clinic",
      specialty: "general",
      defaultLanguage: "ar",
      timezone: "Asia/Kuwait",
      adminName: "Admin Person",
      adminEmail: "admin@example.test",
      maxUsers: 10,
      maxBranches: 3,
      modules: { patients: false, appointments: true, medical: true, finance: false },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["modules", "medical"], "validation.moduleRequires"],
    ]);
  });
});
