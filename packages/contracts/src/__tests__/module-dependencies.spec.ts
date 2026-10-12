import { describe, expect, it } from "vitest";

import { moduleDependencyGap } from "../onboarding.ts";
import { DEFAULT_PLATFORM_SETTINGS, platformSettingsSchema } from "../platform.ts";

// P2-14: one table decides it for the create form, the platform default and the per-clinic switch.
describe("medical needs patients", () => {
  it.each([
    [{ patients: true, appointments: false, medical: true }, null],
    [{ patients: false, appointments: true, medical: false }, null],
    [
      { patients: false, appointments: false, medical: true },
      { module: "medical", requires: "patients" },
    ],
  ])("%j → %j", (flags, gap) => {
    expect(moduleDependencyGap(flags)).toEqual(gap);
  });

  it("NEGATIVE: a platform default with medical but not patients is refused on the medical flag", () => {
    const result = platformSettingsSchema.safeParse({
      ...DEFAULT_PLATFORM_SETTINGS,
      defaultModules: { patients: false, appointments: true, medical: true },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["defaultModules", "medical"], "validation.moduleRequires"],
    ]);
  });
});
