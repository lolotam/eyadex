import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePatientPicker } from "./invoice-patient-picker";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    patients: {
      list: async (_p: unknown, q: { q: string }) => {
        calls.push(q.q);
        return { items: [], nextCursor: null, total: 0 };
      },
    },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null }, ready: true }),
  useSession: () => ({ session: null }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the invoice patient picker", () => {
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
