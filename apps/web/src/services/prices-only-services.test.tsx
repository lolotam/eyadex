import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import type { RowAction } from "@/shared/table/row-actions-menu";
import { PricesOnlyServices } from "./prices-only-services";
import { ServicesPage } from "./services-page";

const state = vi.hoisted(() => ({ permissions: [] as string[], finance: true }));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({
    session: { permissions: state.permissions, features: { finance: state.finance } },
  }),
  usePersona: () => ({ persona: { kind: "clinic_admin" } }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: "a" }));
vi.mock("./price-queries", async (original) => ({
  ...(await original<object>()),
  usePriceList: () => ({
    data: {
      currency: "KWD",
      currencyExponent: 3,
      items: [
        {
          serviceId: "service",
          nameAr: "خدمة",
          nameEn: "Service",
          status: "active",
          priceMinor: null,
          providerPrices: [],
        },
      ],
    },
    isLoading: false,
  }),
}));
vi.mock("./service-price-dialog", () => ({ ServicePriceDialog: () => null }));
vi.mock("./provider-prices-dialog", () => ({ ProviderPricesDialog: () => null }));
// Render the menu's supplied actions directly; the screen still builds the actual table columns.
vi.mock("@/shared/table/row-actions-menu", () => ({
  RowActionsMenu: ({ actions }: { actions: RowAction[] }) => (
    <>
      {actions.map((a) => (
        <button key={a.label}>{a.label}</button>
      ))}
    </>
  ),
}));

beforeEach(() => {
  state.permissions = ["view:prices:clinic", "update:prices:clinic"];
  state.finance = true;
});
afterEach(cleanup);

function show(page = false) {
  render(
    <I18nProvider manageDocument={false}>
      {page ? <ServicesPage frame={(content) => content} /> : <PricesOnlyServices />}
    </I18nProvider>,
  );
}

describe("prices-only actions", () => {
  it("the services URL is forbidden for prices-only access with finance off", () => {
    state.finance = false;
    show(true);
    expect(screen.getByText("غير مسموح")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تعديل السعر" })).toBeNull();
  });

  it("the services URL opens the prices-only screen with finance on", () => {
    show(true);
    expect(screen.getByRole("button", { name: "تعديل السعر" })).toBeTruthy();
    expect(screen.queryByText("غير مسموح")).toBeNull();
  });
  it("keeps base-price editing but hides doctor prices without schedule view", () => {
    show();
    expect(screen.getByRole("button", { name: "تعديل السعر" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "أسعار الدكاترة" })).toBeNull();
  });

  it.each(["clinic", "branch", "own"])("offers doctor prices with view:schedules:%s", (scope) => {
    state.permissions.push(`view:schedules:${scope}`);
    show();
    expect(screen.getByRole("button", { name: "تعديل السعر" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "أسعار الدكاترة" })).toBeTruthy();
  });
});
