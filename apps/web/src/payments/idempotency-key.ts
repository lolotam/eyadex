import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readMinor } from "@eyadex/contracts/money";

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

/** A fresh Idempotency-Key: the screen mints it, the API reads it back on a retry. */
const newKey = () => crypto.randomUUID();

/** The invoice and the paid amount a held key was minted under. */
export type HeldContext = { invoiceId: string; paidMinor: string };

/** A held key with the request and the invoice state it is allowed to answer. */
export type HeldRequest = {
  fingerprint: string;
  key: string;
  invoiceId: string;
  paidMinor: string;
};

/** The keys one invoice holds: one per operation. */
export type HeldSlot = Record<KeyedOperation, HeldRequest | null>;

export type HeldKeys = {
  keyOf: (operation: KeyedOperation, request: unknown) => string;
  drop: (operation: KeyedOperation) => void;
  /**
   * Whether the invoice's paid amount went up under the held key of that action: the key can no longer
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

/** The slot of one invoice: the keys it holds, minted and dropped on their own. */
function slotOf(held: Map<string, HeldSlot>, invoiceId: string): HeldSlot {
  const found = held.get(invoiceId);
  if (found) return found;
  const fresh: HeldSlot = { pay: null, credit: null };
  held.set(invoiceId, fresh);
  return fresh;
}

/**
 * The report of the invoice on screen: a held key warns only when the paid amount went up since the key
 * was minted, since only then may the earlier request have been recorded on the server. A paid amount
 * that went down (an edit that released money into credit, a refund) records no payment, so it warns
 * nothing.
 */
function reportsOf(
  slot: HeldSlot | undefined,
  invoiceId: string,
  paidMinor: string,
): Record<KeyedOperation, boolean> {
  const moved = (operation: KeyedOperation) => {
    const request = slot?.[operation];
    if (!request || request.invoiceId !== invoiceId) return false;
    const before = readMinor(request.paidMinor);
    const now = readMinor(paidMinor);
    return before !== null && now !== null && now > before;
  };
  return { pay: moved("pay"), credit: moved("credit") };
}

/**
 * One held key per operation and per invoice, kept above the dialogs: a failure whose outcome is unclear
 * (a timeout, a lost answer) keeps the key, so reopening with the same values lets the API replay instead
 * of recording twice. Every invoice keeps its own keys, so a send on another invoice never takes the key
 * held for this one. The key is bound to the invoice and to its paid amount, so it never crosses to
 * another invoice and never answers a payment the invoice already reflects. A key is dropped only on a
 * confirmed success.
 */
export function useHeldKeys({ invoiceId, paidMinor }: HeldContext): HeldKeys {
  const held = useRef<Map<string, HeldSlot>>(new Map());
  const [paidChanged, setPaidChanged] = useState<Record<KeyedOperation, boolean>>({
    pay: false,
    credit: false,
  });
  const report = useCallback(
    (slot: HeldSlot | undefined) => {
      setPaidChanged((current) => {
        const next = reportsOf(slot, invoiceId, paidMinor);
        return next.pay === current.pay && next.credit === current.credit ? current : next;
      });
    },
    [invoiceId, paidMinor],
  );
  const keyOf = useCallback(
    (operation: KeyedOperation, request: unknown) => {
      const slot = slotOf(held.current, invoiceId);
      const context: HeldContext = { invoiceId, paidMinor };
      const next = heldFor(slot[operation] ?? null, JSON.stringify(request), context, newKey);
      slot[operation] = next;
      // The key answers the invoice as it is now, so the report is rebuilt from it.
      report(slot);
      return next.key;
    },
    [invoiceId, paidMinor, report],
  );
  const drop = useCallback(
    (operation: KeyedOperation) => {
      const slot = slotOf(held.current, invoiceId);
      slot[operation] = null;
      report(slot);
    },
    [invoiceId, report],
  );
  // The report belongs to the invoice on screen, so it is rebuilt for it and never carried over: a
  // warning about a payment recorded on another invoice is false here, and it must not follow the
  // user to a new invoice.
  useEffect(() => {
    report(held.current.get(invoiceId));
  }, [invoiceId, report]);
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
