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

/**
 * The money state of one invoice: the paid amount and the number of movements it showed, as ONE answer
 * of the payments query. The two halves belong together, so they move together: a refresh that moves
 * the invoice rotates a held key once and never once per source (PR #111 review). The movements never
 * net out — a payment that was recorded and then refunded leaves the paid amount as it was — so their
 * count is what tells that the invoice moved under a key whose paid amount did not change.
 */
export type HeldContext = { invoiceId: string; paidMinor: string; revision: number };

/**
 * What the hook takes: the invoice and the money state its keys are bound to — the paid amount and the
 * movement count of one payments-query answer. The paid amount is null while the panel has no real
 * answer yet, so a key is never minted against an unknown invoice. The revision is optional, so a
 * caller that reads no movements of its own binds its key to the invoice and its paid amount alone.
 */
export type HeldInput = { invoiceId: string; paidMinor: string | null; revision?: number };

/** A held key with the request and the invoice state it is allowed to answer. */
export type HeldRequest = {
  fingerprint: string;
  key: string;
  invoiceId: string;
  paidMinor: string;
  revision: number;
};

/** The slot of one invoice: the key it holds per operation and the warning each one raised. */
export type HeldSlot = {
  /** The held key of each operation, minted and dropped on their own. */
  keys: Record<KeyedOperation, HeldRequest | null>;
  /**
   * Whether the invoice moved under the held key of that operation: its paid amount changed or a
   * movement was added to it. It lives in the invoice's slot, so it stays until a confirmed success
   * drops the key and never reaches another invoice.
   */
  warned: Record<KeyedOperation, boolean>;
  /**
   * Whether the next send has to replace the held key of that operation: the invoice moved under it,
   * so the key it holds may already be recorded and must not answer the new request.
   */
  rotate: Record<KeyedOperation, boolean>;
};

export type HeldKeys = {
  keyOf: (operation: KeyedOperation, request: unknown) => string;
  drop: (operation: KeyedOperation) => void;
  /**
   * Whether the invoice moved under the held key of that action: the key can no longer answer a new
   * request, and the earlier one may have been recorded, so the user is told before sending.
   */
  paidChanged: Record<KeyedOperation, boolean>;
};

/**
 * A held key answers one request on one invoice state only: a change in the invoice's paid amount or
 * one movement added to it means the earlier request may have been recorded on the server, so its key
 * must not replay for a new payment, while an edit that leaves the invoice alone keeps the key, so a
 * lost answer can still replay. A caller that replaces a warned key offers no previous key: the warned
 * key never answers again, not even when the invoice returns to the state it was minted under.
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
    previous.paidMinor === context.paidMinor &&
    previous.revision === context.revision
  ) {
    return previous;
  }
  const keyed = keyFor(null, fingerprint, make);
  return {
    ...keyed,
    invoiceId: context.invoiceId,
    paidMinor: context.paidMinor,
    revision: context.revision,
  };
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
 * Whether the invoice moved under a held key: its paid amount is no longer the one the key was minted
 * under, or a movement was added to it since. The movements are the second half of the answer, because
 * they never net out: a payment that was recorded and then refunded leaves the paid amount as it was,
 * and only the count of them shows that the invoice moved.
 */
function movedUnder(request: HeldRequest, context: HeldContext): boolean {
  return paidMoved(request.paidMinor, context.paidMinor) || request.revision !== context.revision;
}

/**
 * The report of the invoice on screen: a held key warns when the invoice moved under it — its paid
 * amount is no longer the one it was minted under, in either direction, or a movement was added to it.
 * A payment can land and a refund or an edit can release money again, so the net can drop too, and a
 * payment that was recorded and then refunded leaves the net as it was: only the movements show that.
 * The warning is kept in the invoice's slot, so it survives the new key of a retry and a failed retry,
 * and only a confirmed success drops it. Without a money state there is nothing to compare the held
 * key with, so no invoice is reported as moved.
 */
function reportOf(
  slot: HeldSlot | undefined,
  context: HeldContext | null,
): Record<KeyedOperation, boolean> {
  const warned: Record<KeyedOperation, boolean> = { pay: false, credit: false };
  if (!slot) return warned;
  for (const operation of OPERATIONS) {
    const request = slot.keys[operation];
    if (
      context !== null &&
      request &&
      request.invoiceId === context.invoiceId &&
      movedUnder(request, context)
    ) {
      slot.warned[operation] = true;
      // The key held under the old state may already be recorded on the server, so it must not answer
      // the next request. The next send replaces it once: the replacement answers the sends after it,
      // so a second unclear failure replays it instead of recording a second payment.
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
 * held for this one. The key is bound to the invoice and to the money state it was minted under — the
 * paid amount and the movement count of one payments-query answer — so it never crosses to another
 * invoice and never answers a payment the invoice already reflects. A key is dropped only on a
 * confirmed success. A warned key is never reused: once the invoice moved under it, the next send
 * replaces it with one fresh key, and that replacement answers the sends after it until the invoice
 * moves again or a success drops it.
 */
export function useHeldKeys({ invoiceId, paidMinor, revision = 0 }: HeldInput): HeldKeys {
  const held = useRef<Map<string, HeldSlot>>(new Map());
  const [paidChanged, setPaidChanged] = useState<Record<KeyedOperation, boolean>>({
    pay: false,
    credit: false,
  });
  // The money state the keys are bound to: the paid amount and the movement count of ONE answer of the
  // payments query. Without a paid amount there is no state yet, so no key is minted against it.
  const context = useMemo(
    () => (paidMinor === null ? null : { invoiceId, paidMinor, revision }),
    [invoiceId, paidMinor, revision],
  );
  const report = useCallback(
    (slot: HeldSlot | undefined) => {
      const next = reportOf(slot, context);
      setPaidChanged((current) =>
        next.pay === current.pay && next.credit === current.credit ? current : next,
      );
    },
    [context],
  );
  const keyOf = useCallback(
    (operation: KeyedOperation, request: unknown) => {
      const slot = slotOf(held.current, invoiceId);
      // Without a money state there is nothing to bind a key to, and the panel keeps its actions off
      // until the state is real, so no request is ever sent with the key this returns.
      if (!context) return "";
      // The key held under a state that moved may already be recorded on the server, so it must not
      // answer the new request. The rotation mints one fresh key for the state as it is now, and the
      // sends after it reuse that key: a second unclear failure replays it instead of recording a
      // second payment.
      const replacing = slot.rotate[operation];
      const previous = replacing ? null : (slot.keys[operation] ?? null);
      const next = heldFor(previous, JSON.stringify(request), context, newKey);
      slot.keys[operation] = next;
      // The replacement happened: the next send reuses the new key, and only another move of the
      // invoice rotates it again.
      slot.rotate[operation] = false;
      // The key answers the invoice as it is now, so the report is rebuilt from it.
      report(slot);
      return next.key;
    },
    [invoiceId, context, report],
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
