import { describe, expect, it } from "vitest";
import { moduleSwitchLocked } from "./module-switch-lock";

// PR #70: medical needs patients, so neither switch may open the gap.
describe("module switch lock", () => {
  it("medical cannot be switched on while patients is off", () => {
    expect(moduleSwitchLocked("medical", { patients: false, medical: false })).toBe(true);
    expect(moduleSwitchLocked("medical", { patients: true, medical: false })).toBe(false);
  });

  it("patients cannot be switched off while medical is on", () => {
    expect(moduleSwitchLocked("patients", { patients: true, medical: true })).toBe(true);
    expect(moduleSwitchLocked("patients", { patients: true, medical: false })).toBe(false);
  });

  it("other switches stay free", () => {
    const flags = { patients: true, medical: true, appointments: true };
    expect(moduleSwitchLocked("appointments", flags)).toBe(false);
    expect(moduleSwitchLocked("medical", flags)).toBe(false);
  });
});
