import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClinicFinanceTab } from "./clinic-finance-tab";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ finance: { platformFinance: load } }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "platform_admin", clinicId: null, memberId: null } }),
}));
vi.mock("./clinic-finance-totals", () => ({ ClinicFinanceTotals: () => null }));

beforeEach(() => {
  load.mockReset().mockResolvedValue({ currency: "KWD", taxRateBp: 100 });
});
afterEach(cleanup);

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider manageDocument={false}>
        <ClinicFinanceTab clinicId="clinic" />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("platform clinic finance refresh", () => {
  it("keeps the mounted form and unsaved tax on a failed refresh and retry", async () => {
    const client = show();
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).toHaveValue("100"));
    fireEvent.change(input, { target: { value: "275" } });
    load.mockRejectedValue(new Error("network down"));
    await act(async () => {
      await client.refetchQueries();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("275");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    load.mockResolvedValue({ currency: "KWD", taxRateBp: 400 });
    fireEvent.click(screen.getByRole("button", { name: /حاول|Try/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("275");
  });

  it("blocks the initial failure with a retry", async () => {
    load.mockRejectedValue(new Error("network down"));
    show();
    const retry = await screen.findByRole("button", { name: /حاول|Try/ });
    expect(screen.queryByRole("textbox")).toBeNull();
    load.mockResolvedValue({ currency: "KWD", taxRateBp: 100 });
    fireEvent.click(retry);
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
  });
});
