import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClosingsContent } from "./closings-content";

const h = vi.hoisted(() => ({ list: vi.fn(), branchOptions: vi.fn() }));
const BRANCH = "00000000-0000-7000-8000-00000000000b";
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  useSession: () => ({
    session: {
      clinic: { timezone: "Asia/Kuwait" },
      permissions: [
        "view:payments:clinic",
        "view:cash_closings:clinic",
        "create:cash_closings:clinic",
      ],
      branchIds: [],
    },
  }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    cashClosings: { list: h.list },
    payments: { branchOptions: h.branchOptions },
  }),
}));
// The dialog only matters here for its cash_closing_exists hand-off.
vi.mock("./close-dialog", () => ({
  CloseDialog: (p: { onShowClosed: (b: string, d: string) => void }) => (
    <button onClick={() => p.onShowClosed(BRANCH, "2026-03-10")}>show-today</button>
  ),
}));
vi.mock("./closing-count", async (orig) => ({
  ...(await orig<object>()),
  closableBranches: (_s: unknown, b: unknown[]) => b,
}));

afterEach(cleanup);

describe("show today's closing", () => {
  it("fetches the history again, even when that filter's page was already loaded", async () => {
    h.branchOptions.mockResolvedValue({
      items: [{ id: BRANCH, nameAr: "ف", nameEn: "B", isActive: true }],
      nextCursor: null,
    });
    h.list.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ClosingsContent />
        </I18nProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByRole("button", { name: ar.cashClosings.close }));
    fireEvent.click(screen.getByRole("button", { name: ar.cashClosings.close }));
    fireEvent.click(screen.getByText("show-today"));
    await waitFor(() =>
      expect(h.list).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ branchId: BRANCH, from: "2026-03-10" }),
      ),
    );
    const calls = h.list.mock.calls.length;
    // The same filter again: the loaded page is refetched, not served from the cache.
    fireEvent.click(screen.getByRole("button", { name: ar.cashClosings.close }));
    fireEvent.click(screen.getByText("show-today"));
    await waitFor(() => expect(h.list.mock.calls.length).toBeGreaterThan(calls));
  });
});
