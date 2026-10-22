import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/** The invoice and the paid amount a held key was minted under. */
export type HeldContext = { invoiceId: string; paidMinor: string };

/** A held key with the request and the invoice state it is allowed to answer. */
export type HeldRequest = {
  fingerprint: string;
  key: string;
  invoiceId: string;
  paidMinor: string;
};

export type HeldKeys = {
  keyOf: (operation: KeyedOperation, request: unknown) => string;
  drop: (operation: KeyedOperation) => void;
  /**
   * Whether the invoice's paid amount moved under the held key of that action: the key can no longer
   * answer a new request, and the earlier one may have been recorded, so the user is told before sending.
   */
  paidChanged: Record<KeyedOperation, boolean>;
};

/**
 * A held key answers one request on one invoice state only: a change in the invoice's paid amount means
 * the earlier request may have been recorded on the server, so its key must not replay for a new payment,
 * while an edit that leaves the paid amount alone keeps the key, so a lost answer can still replay.
 */
export function heldFor(
  previous: HeldRequest | null,
  fingerprint: string,
  context: HeldContext,
  make: () => string,
): HeldRequest {
  if (
    previous !== null &&
    previous.fingerprint === fingerprint &&
    previous.invoiceId === context.invoiceId &&
    previous.paidMinor === context.paidMinor
  ) {
    return previous;
  }
  const keyed = keyFor(null, fingerprint, make);
  return { ...keyed, invoiceId: context.invoiceId, paidMinor: context.paidMinor };
}

/**
 * One held key per operation, kept above the dialogs: a failure whose outcome is unclear (a timeout, a
 * lost answer) keeps the key, so reopening with the same values lets the API replay instead of recording
 * twice. The key is bound to the invoice and to its paid amount, so it never crosses to another invoice
 * and never answers a payment the invoice already reflects. A key is dropped only on a confirmed success.
 */
export function useHeldKeys({ invoiceId, paidMinor }: HeldContext): HeldKeys {
  const held = useRef<{ keys: Record<KeyedOperation, HeldRequest | null> }>({
    keys: { pay: null, credit: null },
  });
  const [paidChanged, setPaidChanged] = useState<Record<KeyedOperation, boolean>>({
    pay: false,
    credit: false,
  });
  const keyOf = useCallback(
    (operation: KeyedOperation, request: unknown) => {
      const next = heldFor(
        held.current.keys[operation],
        JSON.stringify(request),
        { invoiceId, paidMinor },
        () => crypto.randomUUID(),
      );
      held.current.keys[operation] = next;
      return next.key;
    },
    [invoiceId, paidMinor],
  );
  const drop = useCallback((operation: KeyedOperation) => {
    held.current.keys[operation] = null;
    setPaidChanged((current) =>
      operation === "pay" ? { ...current, pay: false } : { ...current, credit: false },
    );
  }, []);
  // The report belongs to the invoice on screen, so it is rebuilt for it and never carried over: a
  // warning about a payment recorded on another invoice is false here, and it must not follow the
  // user to a new invoice. Only a key held under an older paid amount warns, since the earlier
  // request may have been recorded on the server while the invoice moved on.
  useEffect(() => {
    setPaidChanged((current) => {
      const stale = (operation: KeyedOperation) => {
        const request = held.current.keys[operation];
        return (
          request !== null && request.invoiceId === invoiceId && request.paidMinor !== paidMinor
        );
      };
      const next = {
        pay: stale("pay"),
        credit: stale("credit"),
      };
      return next.pay === current.pay && next.credit === current.credit ? current : next;
    });
  }, [invoiceId, paidMinor]);
  return useMemo(() => ({ keyOf, drop, paidChanged }), [keyOf, drop, paidChanged]);
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
