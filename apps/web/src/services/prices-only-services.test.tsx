import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import type { RowAction } from "@/shared/table/row-actions-menu";
import { PricesOnlyServices } from "./prices-only-services";

const state = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { permissions: state.permissions } }),
}));
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
});
afterEach(cleanup);

function show() {
  render(
    <I18nProvider manageDocument={false}>
      <PricesOnlyServices />
    </I18nProvider>,
  );
}

describe("prices-only actions", () => {
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
