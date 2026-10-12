import { describe, expect, it } from "vitest";
import { firstSettingsTab, visibleSettingsTabs } from "./settings-tabs";

const ids = (keys: string[]) => visibleSettingsTabs(keys).map((tab) => tab.id);

// D-17: each tab of the clinic Settings page shows only to users who can view its resource.
describe("settings tabs", () => {
  it("General, Services and Work schedules, each behind its own view key", () => {
    expect(
      ids(["view:clinic_settings:clinic", "view:services:clinic", "view:schedules:clinic"]),
    ).toEqual(["general", "services", "schedules", "notifications", "email", "whatsapp"]);
    expect(ids(["view:clinic_settings:clinic"])).toEqual(["general", "notifications", "email", "whatsapp"]);
    expect(ids(["view:services:clinic", "view:schedules:branch"])).toEqual([
      "services",
      "schedules",
    ]);
    expect(ids(["update:schedules:branch"])).toEqual([]);
  });

  it("the Settings entry opens the first tab the user can see", () => {
    expect(firstSettingsTab(["view:clinic_settings:clinic", "view:services:clinic"])?.to).toBe(
      "/clinic/settings",
    );
    expect(firstSettingsTab(["view:schedules:branch"])?.to).toBe("/clinic/settings/schedules");
    expect(firstSettingsTab([])).toBeNull();
  });
});
