import { useCallback, useEffect, useRef, useState } from "react";
import type { WhatsappQrResponse } from "@eyadex/contracts/whatsapp";

/** Brief §1: poll every 3 s while the QR waits for its scan, for at most 2 minutes. */
export const QR_POLL_MS = 3000;
export const QR_POLL_LIMIT_MS = 120_000;

/**
 * Polls the QR while `open` and the answer is `pending`. It stops when the channel is connected,
 * when the dialog closes, or after the time limit (`expired`); `refresh` fetches a new code and
 * starts the time limit again.
 */
export function useQrPolling(
  open: boolean,
  initial: WhatsappQrResponse | null,
  fetchQr: () => Promise<WhatsappQrResponse>,
) {
  const [qr, setQr] = useState(initial);
  const [expired, setExpired] = useState(false);
  const [round, setRound] = useState(0);
  const fetchRef = useRef(fetchQr);
  fetchRef.current = fetchQr;

  useEffect(() => {
    setQr(initial);
    setExpired(false);
  }, [initial]);

  const pending = qr?.status === "pending";
  useEffect(() => {
    if (!open || !pending || expired) return;
    const started = Date.now();
    let live = true;
    const timer = setInterval(() => {
      if (Date.now() - started >= QR_POLL_LIMIT_MS) {
        clearInterval(timer);
        setExpired(true);
        return;
      }
      fetchRef.current().then(
        (next) => live && setQr(next),
        () => undefined,
      );
    }, QR_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, pending, expired, round]);

  const refresh = useCallback(async () => {
    const next = await fetchRef.current();
    setQr(next);
    setExpired(false);
    setRound((r) => r + 1);
  }, []);

  return { qr, expired, refresh };
}
