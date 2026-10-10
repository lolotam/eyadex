import { describe, expect, it } from "vitest";
import { SETTINGS_TABS } from "@/settings/settings-tabs";
import { CLINIC_NAV, navItemsFor } from "./nav-items";

const settingsEntry = () => CLINIC_NAV.find((item) => item.to === "/clinic/settings");

// D-17: services and work schedules are tabs of the clinic Settings page, not menu entries.
describe("clinic navigation", () => {
  it("adds no menu entry for services or schedules", () => {
    const paths: string[] = CLINIC_NAV.map((item) => item.to);
    expect(paths).not.toContain("/clinic/services");
    expect(paths).not.toContain("/clinic/schedules");
    expect(paths.filter((to) => to.startsWith("/clinic/settings"))).toEqual(["/clinic/settings"]);
  });

  it("shows Settings to whoever can view any of its tabs, by permission, never by role", () => {
    expect(settingsEntry()?.anyOf).toEqual(["clinic_settings", "services", "schedules"]);
    expect(settingsEntry()?.anyOf).toEqual(SETTINGS_TABS.map((tab) => tab.resource));
    const shows = (keys: string[]) =>
      navItemsFor(CLINIC_NAV, keys).some((item) => item.to === "/clinic/settings");
    expect(shows(["view:services:clinic"])).toBe(true);
    expect(shows(["view:schedules:branch"])).toBe(true);
    expect(shows(["view:clinic_settings:clinic"])).toBe(true);
    expect(shows(["view:patients:branch"])).toBe(false);
  });

  it("keeps the other entries on their own resource", () => {
    const visible = navItemsFor(CLINIC_NAV, ["view:patients:branch"]).map((item) => item.to);
    expect(visible).toEqual(["/clinic", "/clinic/patients", "/clinic/account"]);
  });

  it("A2: shows Appointments to holders of view:appointments only", () => {
    const shows = (keys: string[]) =>
      navItemsFor(CLINIC_NAV, keys).some((item) => item.to === "/clinic/appointments");
    expect(shows(["view:appointments:branch"])).toBe(true);
    expect(shows(["view:appointments:clinic"])).toBe(true);
    expect(shows(["view:patients:branch", "view:schedules:branch"])).toBe(false);
  });

  // A3 inverts Codex PR #64: the own key now has reads that answer it with the caller's own column.
  it("A3: an own-only appointments key shows the branch-day entry; own patients show Patients", () => {
    const shows = (keys: string[], to: string) =>
      navItemsFor(CLINIC_NAV, keys).some((item) => item.to === to);
    expect(shows(["view:appointments:own"], "/clinic/appointments")).toBe(true);
    expect(
      shows(["view:appointments:own", "view:appointments:branch"], "/clinic/appointments"),
    ).toBe(true);
    expect(shows(["view:patients:own"], "/clinic/patients")).toBe(true);
    expect(shows(["view:patients:own"], "/clinic/appointments")).toBe(false);
  });
});
