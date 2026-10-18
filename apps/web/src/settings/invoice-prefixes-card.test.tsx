import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { financeSettingsKey } from "@/shared/money/use-clinic-money";
import { InvoicePrefixesCard } from "./invoice-prefixes-card";

const prefixes = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ branches: { list: async () => ({ items: [] }) }, finance: { prefixes } }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  useSession: () => ({ session: { features: { finance: true } } }),
}));

beforeEach(() => {
  prefixes.mockReset().mockRejectedValue(new ApiError("unknown"));
});
afterEach(cleanup);

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider manageDocument={false}>
        <InvoicePrefixesCard />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

// Lesson 5.1: a failed read is an error with retry, never an empty card.
describe("the invoice prefixes card", () => {
  it("shows an error with a retry button when the read fails", async () => {
    show();
    const retry = await screen.findByRole("button", { name: /حاول|Try/ });
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(prefixes).toHaveBeenCalledTimes(2));
  });

  it("keeps cached prefixes and the open dialog's draft after a failed refresh and retry", async () => {
    prefixes.mockResolvedValue([{ branchId: "branch", invoicePrefix: "OLD", locked: false }]);
    const client = show();
    fireEvent.click(await screen.findByRole("button", { name: "تحديد البادئة" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "DRAFT" } });
    prefixes.mockRejectedValue(new ApiError("unknown"));
    await act(async () => {
      await client.refetchQueries({ queryKey: financeSettingsKey });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The modal makes the cached card inaccessible, but its DOM must stay mounted.
    expect(screen.getByText("OLD")).toBeInTheDocument();
    expect(screen.getByRole("list", { hidden: true })).toBeInTheDocument();
    expect(input).toHaveValue("DRAFT");
    expect(screen.getByRole("textbox")).toBe(input);
    expect(screen.getByRole("alert", { hidden: true })).toBeInTheDocument();
    prefixes.mockResolvedValue([{ branchId: "branch", invoicePrefix: "NEW", locked: false }]);
    fireEvent.click(screen.getByRole("button", { name: /حاول|Try/, hidden: true }));
    await waitFor(() => expect(screen.getByText("NEW")).toBeInTheDocument());
    expect(input).toHaveValue("DRAFT");
  });
});
