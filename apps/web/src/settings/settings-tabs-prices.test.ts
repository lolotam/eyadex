import { describe, expect, it } from "vitest";
import { visibleSettingsTabs } from "./settings-tabs";

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
});
