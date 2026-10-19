import { describe, expect, it } from "vitest";
import { firstSettingsTab, visibleSettingsTabs } from "./settings-tabs";

const tabs = (keys: string[]) => visibleSettingsTabs(keys, { finance: true }).map((t) => t.id);

// Item 8: the services tab follows the same keys as the screen.
describe("the services tab", () => {
  it("shows to a prices-only role and to a services role", () => {
    expect(tabs(["view:prices:clinic"])).toContain("services");
    expect(tabs(["view:services:clinic"])).toContain("services");
  });
  it("NEGATIVE: hidden with neither key", () => {
    expect(tabs(["view:patients:clinic"])).not.toContain("services");
  });
  it.each([{ finance: false }, {}])("hides prices-only access without finance: %j", (features) => {
    expect(visibleSettingsTabs(["view:prices:clinic"], features)).toEqual([]);
    expect(firstSettingsTab(["view:prices:clinic"], features)).toBeNull();
  });
  it("keeps services access when finance is off", () => {
    expect(
      visibleSettingsTabs(["view:services:clinic"], { finance: false }).map((t) => t.id),
    ).toContain("services");
    expect(firstSettingsTab(["view:services:clinic"], { finance: false })?.id).toBe("services");
  });
});
