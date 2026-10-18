import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceListQuery } from "@eyadex/contracts/finance";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicesContent } from "./invoices-content";

const state = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { permissions: [] } }),
}));
vi.mock("./invoice-options", () => ({
  useInvoiceOptions: () => ({ branches: [] }),
}));
vi.mock("./invoice-patient-picker", () => ({ InvoicePatientPicker: () => null }));
vi.mock("./use-invoice-columns", () => ({ useInvoiceColumns: () => [] }));
vi.mock("./invoice-queries", () => ({
  useInvoiceList: (query: Partial<InvoiceListQuery>) => {
    state.list(query);
    return { data: { items: [], total: 60, nextCursor: "next-page" }, isLoading: false };
  },
}));

function show() {
  render(
    <I18nProvider manageDocument={false}>
      <InvoicesContent />
    </I18nProvider>,
  );
  return {
    next: screen.getByRole("button", { name: "التالي" }),
    previous: screen.getByRole("button", { name: "السابق" }),
    search: screen.getByRole("textbox", { name: "رقم الفاتورة" }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  state.list.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("invoice number search pagination", () => {
  it("blocks both pager directions during debounce and starts the effective search at page one", async () => {
    const { next, previous, search } = show();
    fireEvent.click(next);
    expect(previous).toBeEnabled();
    expect(state.list).toHaveBeenLastCalledWith({ limit: 20, cursor: "next-page" });

    fireEvent.change(search, { target: { value: " INV-2 " } });
    expect(next).toBeDisabled();
    expect(previous).toBeDisabled();
    fireEvent.click(next);
    fireEvent.click(previous);
    expect(state.list).toHaveBeenLastCalledWith({ limit: 20, cursor: "next-page" });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(next).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(state.list).toHaveBeenLastCalledWith({ limit: 20, number: "INV-2" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(state.list.mock.calls.some(([query]) => query.number === "INV-2" && query.cursor)).toBe(
      false,
    );
    fireEvent.click(next);
    expect(state.list).toHaveBeenLastCalledWith({
      limit: 20,
      number: "INV-2",
      cursor: "next-page",
    });
    fireEvent.click(previous);
    expect(state.list).toHaveBeenLastCalledWith({ limit: 20, number: "INV-2" });
  });

  it("keeps the cursor for whitespace-only input changes", async () => {
    const { next, previous, search } = show();
    fireEvent.change(search, { target: { value: "INV" } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.click(next);
    fireEvent.change(search, { target: { value: " INV " } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(next).toBeEnabled();
    expect(previous).toBeEnabled();
    expect(state.list).toHaveBeenLastCalledWith({
      limit: 20,
      number: "INV",
      cursor: "next-page",
    });
  });

  it("still resets other filters immediately", () => {
    const { next, previous } = show();
    fireEvent.click(next);
    fireEvent.change(screen.getByLabelText("من"), { target: { value: "2026-10-01" } });
    expect(previous).toBeDisabled();
    expect(state.list).toHaveBeenLastCalledWith({ limit: 20, from: "2026-10-01" });
  });
});
