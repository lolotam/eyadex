import { useCallback, useEffect, useMemo, useRef } from "react";

export type KeyedRequest = { fingerprint: string; key: string } | null;

/**
 * The Idempotency-Key for a submission (spec §4.4): a retry of the same request keeps the key so the API
 * replays the first answer; a changed amount, method or reference gets a new key, since the API would
 * answer the old one with idempotency_conflict.
 */
export function keyFor(
  previous: KeyedRequest,
  fingerprint: string,
  make: () => string,
): { fingerprint: string; key: string } {
  return previous && previous.fingerprint === fingerprint ? previous : { fingerprint, key: make() };
}

export type KeyedOperation = "pay" | "credit";

export type HeldKeys = {
  keyOf: (operation: KeyedOperation, request: unknown) => string;
  drop: (operation: KeyedOperation) => void;
};

/**
 * One held key per operation for an invoice, kept above the dialogs: a failure whose outcome is unclear
 * (a timeout, a lost answer) keeps the key, so reopening with the same values lets the API replay instead
 * of recording twice. A key is dropped on a confirmed success, or when the invoice version changes.
 */
export function useHeldKeys(invoiceVersion: number): HeldKeys {
  const held = useRef<{ version: number; keys: Record<KeyedOperation, KeyedRequest> }>({
    version: invoiceVersion,
    keys: { pay: null, credit: null },
  });
  if (held.current.version !== invoiceVersion) {
    held.current = { version: invoiceVersion, keys: { pay: null, credit: null } };
  }
  const keyOf = useCallback((operation: KeyedOperation, request: unknown) => {
    const next = keyFor(held.current.keys[operation], JSON.stringify(request), () =>
      crypto.randomUUID(),
    );
    held.current.keys[operation] = next;
    return next.key;
  }, []);
  const drop = useCallback((operation: KeyedOperation) => {
    held.current.keys[operation] = null;
  }, []);
  return useMemo(() => ({ keyOf, drop }), [keyOf, drop]);
}

/**
 * Tells the dialog owner whether the form's request is in flight, so it can refuse to close while the
 * outcome is still unknown.
 */
export function usePendingReport(pending: boolean, report?: (pending: boolean) => void): void {
  useEffect(() => {
    report?.(pending);
  }, [pending, report]);
  useEffect(() => () => report?.(false), [report]);
}
