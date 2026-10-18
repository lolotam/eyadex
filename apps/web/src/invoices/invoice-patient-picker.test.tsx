import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePatientPicker } from "./invoice-patient-picker";

const calls = vi.hoisted(() => [] as string[]);
const pending = vi.hoisted(() => ({ resolve: null as null | (() => void) }));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    patients: {
      list: async (_p: unknown, q: { q: string }) => {
        calls.push(q.q);
        if (q.q === "cd")
          await new Promise<void>((resolve) => {
            pending.resolve = resolve;
          });
        return {
          items: [{ id: q.q, fullName: `Sample ${q.q}`, fileNumber: 1 }],
          nextCursor: null,
          total: 1,
        };
      },
    },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  useSession: () => ({ session: null }),
}));

beforeEach(() => {
  calls.length = 0;
  pending.resolve = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the invoice patient picker", () => {
  it("hides earlier results during the debounce and until the new request resolves", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <I18nProvider manageDocument={false}>
          <InvoicePatientPicker value={null} onChange={onChange} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "ab" } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText("Sample ab")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "cd" } });
    expect(screen.queryByRole("list")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(calls).toEqual(["ab", "cd"]);
    expect(pending.resolve).toBeTypeOf("function");
    expect(screen.queryByRole("list")).toBeNull();
    await act(async () => {
      pending.resolve!();
    });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText("Sample ab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sample cd/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "cd" }));
    client.clear();
  });

  it.each(["", " a "])("hides results immediately when the raw input becomes %j", async (value) => {
    vi.useFakeTimers();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <I18nProvider manageDocument={false}>
          <InvoicePatientPicker value={null} onChange={() => undefined} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "ab" } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("list")).toBeInTheDocument();
    fireEvent.change(box, { target: { value } });
    expect(screen.queryByRole("list")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.queryByRole("list")).toBeNull();
    expect(calls).toEqual(["ab"]);
    client.clear();
  });

  it("searches once, after typing stops", async () => {
    vi.useFakeTimers();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider manageDocument={false}>
          <InvoicePatientPicker value={null} onChange={() => undefined} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const box = screen.getByRole("textbox");
    for (const v of ["ab", "abc", "abcd"]) {
      fireEvent.change(box, { target: { value: v } });
      await act(() => vi.advanceTimersByTimeAsync(100));
    }
    expect(calls).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(calls).toEqual(["abcd"]);
  });
});
