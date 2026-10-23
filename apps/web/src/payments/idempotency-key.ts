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

/** The operations that hold a key of their own. */
const OPERATIONS: KeyedOperation[] = ["pay", "credit"];

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

/** The slot of one invoice: the key it holds per operation and the warning each one raised. */
export type HeldSlot = {
  /** The held key of each operation, minted and dropped on their own. */
  keys: Record<KeyedOperation, HeldRequest | null>;
  /**
   * Whether the invoice's paid amount moved under the held key of that operation. It lives in the
   * invoice's slot, so it stays until a confirmed success drops the key and never reaches another
   * invoice.
   */
  warned: Record<KeyedOperation, boolean>;
  /**
   * Whether the next send has to replace the held key of that operation: the paid amount moved
   * under it, so the key it holds may already be recorded and must not answer the new request.
   */
  rotate: Record<KeyedOperation, boolean>;
};

export type HeldKeys = {
  keyOf: (operation: KeyedOperation, request: unknown) => string;
  drop: (operation: KeyedOperation) => void;
  /**
   * Whether the invoice's paid amount changed under the held key of that action: the key can no longer
   * answer a new request, and the earlier one may have been recorded, so the user is told before sending.
   */
  paidChanged: Record<KeyedOperation, boolean>;
};

/**
 * A held key answers one request on one invoice state only: a change in the invoice's paid amount means
 * the earlier request may have been recorded on the server, so its key must not replay for a new payment,
 * while an edit that leaves the paid amount alone keeps the key, so a lost answer can still replay.
 * A caller that replaces a warned key offers no previous key: the warned key never answers
 * again, not even when the paid amount returns to the value it was minted under.
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
  const fresh: HeldSlot = {
    keys: { pay: null, credit: null },
    warned: { pay: false, credit: false },
    rotate: { pay: false, credit: false },
  };
  held.set(invoiceId, fresh);
  return fresh;
}

/** Whether two minor amounts are two different amounts, not two spellings of one. */
function paidMoved(before: string, now: string): boolean {
  const was = readMinor(before);
  const is = readMinor(now);
  return was !== null && is !== null && was !== is;
}

/**
 * The report of the invoice on screen: a held key warns when the invoice's paid amount is no longer the
 * one it was minted under, in either direction — a payment can land and a refund or an edit can release
 * money again, so the net can drop too. The warning is kept in the invoice's slot, so it survives the
 * new key of a retry and a failed retry, and only a confirmed success drops it.
 */
function reportOf(
  slot: HeldSlot | undefined,
  invoiceId: string,
  paidMinor: string,
): Record<KeyedOperation, boolean> {
  const warned: Record<KeyedOperation, boolean> = { pay: false, credit: false };
  if (!slot) return warned;
  for (const operation of OPERATIONS) {
    const request = slot.keys[operation];
    if (request && request.invoiceId === invoiceId && paidMoved(request.paidMinor, paidMinor)) {
      slot.warned[operation] = true;
      // The key held under the old paid amount may already be recorded on the server, so it must
      // not answer the next request. The next send replaces it once: the replacement answers the
      // sends after it, so a second unclear failure replays it instead of recording a second
      // payment.
      slot.rotate[operation] = true;
    }
    warned[operation] = slot.warned[operation];
  }
  return warned;
}

/**
 * One held key per operation and per invoice, kept above the dialogs: a failure whose outcome is unclear
 * (a timeout, a lost answer) keeps the key, so reopening with the same values lets the API replay instead
 * of recording twice. Every invoice keeps its own keys, so a send on another invoice never takes the key
 * held for this one. The key is bound to the invoice and to its paid amount, so it never crosses to
 * another invoice and never answers a payment the invoice already reflects. A key is dropped only on a
 * confirmed success. A warned key is never reused: once the paid amount moved under it, the
 * next send replaces it with one fresh key, and that replacement answers the sends after it until
 * the paid amount moves again or a success drops it.
 */
export function useHeldKeys({ invoiceId, paidMinor }: HeldContext): HeldKeys {
  const held = useRef<Map<string, HeldSlot>>(new Map());
  const [paidChanged, setPaidChanged] = useState<Record<KeyedOperation, boolean>>({
    pay: false,
    credit: false,
  });
  const report = useCallback(
    (slot: HeldSlot | undefined) => {
      const next = reportOf(slot, invoiceId, paidMinor);
      setPaidChanged((current) =>
        next.pay === current.pay && next.credit === current.credit ? current : next,
      );
    },
    [invoiceId, paidMinor],
  );
  const keyOf = useCallback(
    (operation: KeyedOperation, request: unknown) => {
      const slot = slotOf(held.current, invoiceId);
      const context: HeldContext = { invoiceId, paidMinor };
      // The key held under a paid amount that moved may already be recorded on the server, so it
      // must not answer the new request. The rotation mints one fresh key for the paid amount as
      // it is now, and the sends after it reuse that key: a second unclear failure replays it
      // instead of recording a second payment.
      const replacing = slot.rotate[operation];
      const previous = replacing ? null : (slot.keys[operation] ?? null);
      const next = heldFor(previous, JSON.stringify(request), context, newKey);
      slot.keys[operation] = next;
      // The replacement happened: the next send reuses the new key, and only another move of the paid
      // amount rotates it again.
      slot.rotate[operation] = false;
      // The key answers the invoice as it is now, so the report is rebuilt from it.
      report(slot);
      return next.key;
    },
    [invoiceId, paidMinor, report],
  );
  const drop = useCallback(
    (operation: KeyedOperation) => {
      const slot = slotOf(held.current, invoiceId);
      slot.keys[operation] = null;
      // A confirmed success: the key is released and the warning it raised goes with it.
      slot.warned[operation] = false;
      // The key to replace is released too, so the next send mints its own key from the start.
      slot.rotate[operation] = false;
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
