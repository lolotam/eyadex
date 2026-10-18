import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClinicFinanceTotals } from "./clinic-finance-totals";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: { platformTotals: load },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "platform_admin", clinicId: null, memberId: null } }),
}));

beforeEach(() => {
  load.mockReset().mockRejectedValue(new Error("network down"));
});
afterEach(cleanup);

// PR #78 review: a failed read showed «لا توجد فواتير بعد», as if the clinic had invoiced nothing.
describe("the platform's clinic totals", () => {
  it("keeps cached totals visible after a failed refresh and retries", async () => {
    const totals = { months: [{ month: "2026-10", currency: "KWD", invoicedMinor: "1000" }] };
    load.mockResolvedValue(totals);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider manageDocument={false}>
          <ClinicFinanceTotals clinicId="clinic" />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const table = await screen.findByRole("table");
    load.mockRejectedValue(new Error("network down"));
    await act(async () => {
      await client.refetchQueries();
    });
    await screen.findByRole("alert");
    expect(screen.getByRole("table")).toBe(table);
    expect(screen.getByText("1.000 KWD")).toBeInTheDocument();
    load.mockResolvedValue(totals);
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("table")).toBe(table);
  });

  it("says the totals could not load and offers a retry instead of an empty report", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider manageDocument={false}>
          <ClinicFinanceTotals clinicId="00000000-0000-7000-8000-000000000001" />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("تعذّر تحميل الإجماليات")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeTruthy();
    expect(screen.queryByText("لا توجد فواتير بعد")).toBeNull();
  });
});
