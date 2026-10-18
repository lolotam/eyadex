import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePrefixesCard } from "./invoice-prefixes-card";

const refetch = vi.fn();
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ branches: { list: async () => ({ items: [] }) }, finance: {} }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null } }),
}));
vi.mock("./finance-queries", () => ({
  useInvoicePrefixes: () => ({
    isError: true,
    isLoading: false,
    error: new ApiError("unknown"),
    refetch,
  }),
  useRefreshFinanceSettings: () => () => undefined,
}));

afterEach(cleanup);

// Lesson 5.1: a failed read is an error with retry, never an empty card.
describe("the invoice prefixes card", () => {
  it("shows an error with a retry button when the read fails", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider manageDocument={false}>
          <InvoicePrefixesCard />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /حاول|Try/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
