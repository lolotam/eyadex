import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePatientPicker } from "./invoice-patient-picker";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    patients: {
      list: async (_p: unknown, q: { q: string }) => {
        calls.push(q.q);
        return {
          items: [{ id: "patient", fullName: "Sample patient", fileNumber: 1 }],
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
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the invoice patient picker", () => {
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
