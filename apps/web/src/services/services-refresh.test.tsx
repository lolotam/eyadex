import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import type { RowAction } from "@/shared/table/row-actions-menu";
import { priceKeys } from "./price-queries";
import { PricesOnlyServices } from "./prices-only-services";
import { ServicesContent } from "./services-content";
import { serviceKeys } from "./service-queries";

const service = vi.hoisted(() => ({
  id: "service",
  clinicId: "clinic",
  nameAr: "خدمة",
  nameEn: "Service",
  durationMinutes: 30,
  status: "active",
}));
const requests = vi.hoisted(() => ({ pricesFail: false, servicesFail: false }));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: {
      prices: async () => {
        if (requests.pricesFail) throw new ApiError("not_found");
        return {
          currency: "KWD",
          currencyExponent: 3,
          items: [{ ...service, serviceId: service.id, priceMinor: "1000", providerPrices: [] }],
        };
      },
    },
    scheduling: {
      listServices: async () => {
        if (requests.servicesFail) throw new ApiError("not_found");
        return { items: [service], total: 1, nextCursor: null };
      },
    },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "clinic" }, ready: true }),
  useSession: () => ({
    session: {
      permissions: ["view:prices:clinic", "update:prices:clinic", "view:services:clinic"],
      features: { finance: true },
    },
  }),
}));
vi.mock("./provider-prices-dialog", () => ({ ProviderPricesDialog: () => null }));
vi.mock("./service-form-dialog", () => ({ ServiceFormDialog: () => null }));
vi.mock("./service-status-dialog", () => ({ ServiceStatusDialog: () => null }));
vi.mock("@/shared/table/row-actions-menu", () => ({
  RowActionsMenu: ({ actions }: { actions: RowAction[] }) => (
    <>
      {actions.map((a) => (
        <button key={a.label} onClick={a.onSelect}>
          {a.label}
        </button>
      ))}
    </>
  ),
}));

beforeEach(() => {
  requests.pricesFail = false;
  requests.servicesFail = false;
});
afterEach(cleanup);

describe("service screens after a failed background refresh", () => {
  it.each(["prices", "services"] as const)(
    "keeps price edits mounted when %s fails",
    async (kind) => {
      const client = new QueryClient();
      render(
        <QueryClientProvider client={client}>
          <I18nProvider manageDocument={false}>
            {kind === "prices" ? <PricesOnlyServices /> : <ServicesContent />}
          </I18nProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "تعديل السعر" }));
      const input = screen.getByRole("textbox", { name: "السعر" });
      fireEvent.change(input, { target: { value: "42.125" } });
      requests.pricesFail = kind === "prices";
      requests.servicesFail = kind === "services";
      const queryKey = kind === "prices" ? priceKeys.all : serviceKeys.all;
      await act(() => client.refetchQueries({ queryKey }));
      await waitFor(() =>
        expect(client.getQueryCache().find({ queryKey, exact: false })?.state.status).toBe("error"),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "السعر" })).toBe(input);
      expect(input).toHaveValue("42.125");
      expect(screen.getByRole("table", { hidden: true })).toBeInTheDocument();
      expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent("تعذّر تحميل الخدمات");
      requests.pricesFail = false;
      requests.servicesFail = false;
      fireEvent.click(screen.getByRole("button", { name: "حاول مرة أخرى", hidden: true }));
      await waitFor(() => expect(screen.queryByRole("alert", { hidden: true })).toBeNull());
      expect(input).toHaveValue("42.125");
      client.clear();
    },
  );

  it.each(["prices", "services"] as const)(
    "blocks an initial %s failure until retry succeeds",
    async (kind) => {
      requests.pricesFail = kind === "prices";
      requests.servicesFail = kind === "services";
      const client = new QueryClient();
      render(
        <QueryClientProvider client={client}>
          <I18nProvider manageDocument={false}>
            {kind === "prices" ? <PricesOnlyServices /> : <ServicesContent />}
          </I18nProvider>
        </QueryClientProvider>,
      );
      const retry = await screen.findByRole("button", { name: "حاول مرة أخرى" });
      expect(screen.queryByRole("table")).toBeNull();
      requests.pricesFail = false;
      requests.servicesFail = false;
      fireEvent.click(retry);
      expect(await screen.findByRole("table")).toBeInTheDocument();
      client.clear();
    },
  );
});
