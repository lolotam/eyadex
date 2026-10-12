import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsappQrResponse } from "@eyadex/contracts/whatsapp";
import { QR_POLL_LIMIT_MS, QR_POLL_MS, useQrPolling } from "./use-qr-polling";

const PENDING: WhatsappQrResponse = { status: "pending", qrDataUrl: "data:image/png;base64,AA==" };
const CONNECTED: WhatsappQrResponse = { status: "connected", qrDataUrl: null };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

describe("QR polling", () => {
  it("polls every 3 s and stops once connected", async () => {
    const fetchQr = vi.fn().mockResolvedValueOnce(PENDING).mockResolvedValue(CONNECTED);
    const { result } = renderHook(() => useQrPolling(true, PENDING, fetchQr));
    await tick(QR_POLL_MS);
    expect(fetchQr).toHaveBeenCalledTimes(1);
    await tick(QR_POLL_MS);
    expect(result.current.qr?.status).toBe("connected");
    await tick(QR_POLL_MS * 5);
    expect(fetchQr).toHaveBeenCalledTimes(2);
  });

  it("stops when the dialog closes", async () => {
    const fetchQr = vi.fn().mockResolvedValue(PENDING);
    const { rerender } = renderHook(({ open }) => useQrPolling(open, PENDING, fetchQr), {
      initialProps: { open: true },
    });
    await tick(QR_POLL_MS);
    rerender({ open: false });
    await tick(QR_POLL_MS * 5);
    expect(fetchQr).toHaveBeenCalledTimes(1);
  });

  it("expires after 2 minutes; refresh starts again", async () => {
    const fetchQr = vi.fn().mockResolvedValue(PENDING);
    const { result } = renderHook(() => useQrPolling(true, PENDING, fetchQr));
    await tick(QR_POLL_LIMIT_MS + QR_POLL_MS);
    expect(result.current.expired).toBe(true);
    const calls = fetchQr.mock.calls.length;
    await tick(QR_POLL_MS * 5);
    expect(fetchQr).toHaveBeenCalledTimes(calls);
    await act(async () => result.current.refresh());
    expect(result.current.expired).toBe(false);
    await tick(QR_POLL_MS);
    expect(fetchQr.mock.calls.length).toBeGreaterThan(calls + 1);
  });
});
