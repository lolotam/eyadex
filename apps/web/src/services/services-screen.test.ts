import { beforeEach, describe, expect, it } from "vitest";
import { as, api, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { navItemsFor, CLINIC_NAV } from "@/shared/shell/nav-items";
import { servicesScreenOf } from "./services-screen";
import { servicesOfPriceList } from "./services-of-price-list";

const PRICES = ["view:prices:clinic", "update:prices:clinic"];
const SERVICES = ["view:services:clinic"];
const settingsInNav = (keys: string[]) =>
  navItemsFor(CLINIC_NAV, keys).some((i) => i.to === "/clinic/settings");

beforeEach(() => resetMockData());

// Item 8: the screen, its tab and the menu entry agree for every key combination.
describe("who reaches the services screen", () => {
  it("prices only: the prices-only screen", () => {
    expect(servicesScreenOf(PRICES, undefined, true)).toBe("prices");
    expect(settingsInNav(PRICES)).toBe(true);
  });
  it("services only: the full screen", () => {
    expect(servicesScreenOf(SERVICES)).toBe("full");
  });
  it("both: the full screen", () => {
    expect(servicesScreenOf([...SERVICES, ...PRICES])).toBe("full");
  });
  it("NEGATIVE: neither key: no screen, no tab, no menu entry", () => {
    expect(servicesScreenOf(["view:patients:clinic"])).toBe("none");
    expect(settingsInNav(["view:patients:clinic"])).toBe(false);
  });
  it("NEGATIVE: prices-only access needs finance enabled", () => {
    expect(servicesScreenOf(PRICES, undefined, false)).toBe("none");
  });
  it("services access is independent of finance", () => {
    expect(servicesScreenOf(SERVICES, undefined, false)).toBe("full");
    expect(servicesScreenOf([...SERVICES, ...PRICES], undefined, false)).toBe("full");
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
