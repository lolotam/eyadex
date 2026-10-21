import { describe, expect, it } from "vitest";
import { visibleFinanceTabs } from "./finance-tab-list";
import { CLINIC_NAV, navItemsFor } from "./nav-items";

const shows = (keys: string[]) =>
  navItemsFor(CLINIC_NAV, keys).some((item) => item.to === "/clinic/invoices");

describe("the finance menu entry and tabs (card 1b)", () => {
  it("shows the entry with view:invoices or view:payments, never without both", () => {
    expect(shows(["view:invoices:own"])).toBe(true);
    expect(shows(["view:payments:branch"])).toBe(true);
    expect(shows(["create:payments:clinic", "view:patients:clinic"])).toBe(false);
  });

  it("offers each tab only to its view key", () => {
    const ids = (keys: string[]) => visibleFinanceTabs(keys).map((t) => t.id);
    expect(ids(["view:invoices:clinic", "view:payments:clinic"])).toEqual(["invoices", "payments"]);
    expect(ids(["view:payments:branch"])).toEqual(["payments"]);
    expect(ids(["view:invoices:own"])).toEqual(["invoices"]);
  });
});
