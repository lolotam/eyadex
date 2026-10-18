import { beforeEach, describe, expect, it } from "vitest";
import { as, api, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { visibleSettingsTabs } from "@/settings/settings-tabs";
import { navItemsFor, CLINIC_NAV } from "@/shared/shell/nav-items";
import { servicesScreenOf } from "./services-screen";
import { servicesOfPriceList } from "./services-of-price-list";

const PRICES = ["view:prices:clinic", "update:prices:clinic"];
const SERVICES = ["view:services:clinic"];
const tabs = (keys: string[]) => visibleSettingsTabs(keys, { finance: true }).map((t) => t.id);
const settingsInNav = (keys: string[]) =>
  navItemsFor(CLINIC_NAV, keys).some((i) => i.to === "/clinic/settings");

beforeEach(() => resetMockData());

// Item 8: the screen, its tab and the menu entry agree for every key combination.
describe("who reaches the services screen", () => {
  it("prices only: the prices-only screen", () => {
    expect(servicesScreenOf(PRICES)).toBe("prices");
    expect(tabs(PRICES)).toContain("services");
    expect(settingsInNav(PRICES)).toBe(true);
  });
  it("services only: the full screen", () => {
    expect(servicesScreenOf(SERVICES)).toBe("full");
    expect(tabs(SERVICES)).toContain("services");
  });
  it("both: the full screen", () => {
    expect(servicesScreenOf([...SERVICES, ...PRICES])).toBe("full");
  });
  it("NEGATIVE: neither key: no screen, no tab, no menu entry", () => {
    expect(servicesScreenOf(["view:patients:clinic"])).toBe("none");
    expect(tabs(["view:patients:clinic"])).not.toContain("services");
    expect(settingsInNav(["view:patients:clinic"])).toBe(false);
  });
});

describe("the mock price list", () => {
  it("carries each service's names and status, as the API", async () => {
    const list = await api.finance.prices(as("clinic_admin"));
    const first = list.items[0];
    const service = getState().services.find((s) => s.id === first?.serviceId);
    expect(first).toMatchObject({
      nameAr: service?.nameAr,
      nameEn: service?.nameEn,
      status: service?.status,
    });
    expect(servicesOfPriceList(list)[0]?.nameEn).toBe(service?.nameEn);
  });
});
