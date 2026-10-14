import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T08:00:10.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.mockReset();
});

describe.each(["appointment", "visit"] as const)("%s receipt updates", (subject) => {
  function mountHistory() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ...renderHook(() => useMessageHistory(subject, "subject"), { wrapper }) };
  }

  it("refetches sent and delivered WhatsApp rows until read", async () => {
    const delivered = { ...sent, deliveredAt: "2026-10-14T08:00:04.000Z" };
    const read = { ...delivered, readAt: "2026-10-14T08:00:07.000Z" };
    history
      .mockResolvedValueOnce({ items: [sent] })
      .mockResolvedValueOnce({ items: [delivered] })
      .mockResolvedValue({ items: [read] });
    const { client, result } = mountHistory();
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

  it("does not poll an unread row sent more than ten minutes ago", async () => {
    const old = { ...sent, sentAt: "2026-10-14T07:50:09.999Z" };
    history.mockResolvedValue({ items: [old] });
    const { client, result } = mountHistory();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.data?.items).toEqual([old]);
    expect(history).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(history).toHaveBeenCalledOnce();
    client.clear();
  });

  it("still polls a fresh row whose server time is ahead of the device clock", async () => {
    const ahead = { ...sent, sentAt: "2026-10-14T08:01:10.000Z" };
    history.mockResolvedValue({ items: [ahead] });
    const { client } = mountHistory();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(history).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5010);
    });
    expect(history).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("does not poll a row whose sentAt is more than ten minutes ahead", async () => {
    const far = { ...sent, sentAt: "2026-10-14T08:10:10.001Z" };
    history.mockResolvedValue({ items: [far] });
    const { client } = mountHistory();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15010);
    });
    expect(history).toHaveBeenCalledOnce();
    client.clear();
  });

  it("stops polling an unread row when its ten-minute window expires", async () => {
    const expiring = { ...sent, sentAt: "2026-10-14T07:50:15.000Z" };
    history.mockResolvedValue({ items: [expiring] });
    const { client } = mountHistory();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5010);
    });
    expect(history).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(history).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("keeps polling queued rows every 1500 ms regardless of age", async () => {
    const queued = { ...sent, status: "queued" as const, sentAt: null, route: null };
    history.mockResolvedValue({ items: [queued] });
    const { client } = mountHistory();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1510);
    });
    expect(history).toHaveBeenCalledTimes(2);
    client.clear();
  });
});
