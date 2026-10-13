import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PatientNotification } from "@eyadex/contracts/notifications";
import { useMessageHistory } from "./use-message-history";

const history = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ notifications: { appointmentHistory: history, visitHistory: history } }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
}));

const sent: PatientNotification = {
  id: "00000000-0000-7000-8000-000000000001",
  kind: "booked",
  channel: "whatsapp",
  status: "sent",
  route: "coexistence",
  skipReason: null,
  failureReason: null,
  createdAt: "2026-10-14T08:00:00.000Z",
  sentAt: "2026-10-14T08:00:01.000Z",
  deliveredAt: null,
  readAt: null,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.mockReset();
});

describe.each(["appointment", "visit"] as const)("%s receipt updates", (subject) => {
  it("refetches sent and delivered WhatsApp rows until read", async () => {
    vi.useFakeTimers();
    const delivered = { ...sent, deliveredAt: "2026-10-14T08:00:04.000Z" };
    const read = { ...delivered, readAt: "2026-10-14T08:00:07.000Z" };
    history
      .mockResolvedValueOnce({ items: [sent] })
      .mockResolvedValueOnce({ items: [delivered] })
      .mockResolvedValue({ items: [read] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMessageHistory(subject, "subject"), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.data?.items).toEqual([sent]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5010);
    });
    expect(result.current.data?.items).toEqual([delivered]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5010);
    });
    expect(result.current.data?.items).toEqual([read]);
    const calls = history.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(history).toHaveBeenCalledTimes(calls);
    client.clear();
  });
});
