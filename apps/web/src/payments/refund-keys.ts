import { useCallback, useMemo, useRef } from "react";
import type { RefundSource } from "./refund-form";
import { keyFor, type KeyedRequest } from "./idempotency-key";

/** The slot a refund key is held under: the invoice plus the receipt it refunds, or its credit. */
export function refundSlot(invoiceId: string, source: RefundSource): string {
  return `${invoiceId}:${source.kind === "payment" ? source.paymentId : "credit"}`;
}

export type RefundKeyStore = Map<string, KeyedRequest>;

/**
 * The key for a refund request. A refund lowers the invoice's paid amount, so unlike payments the key is
 * never bound to it: after an unclear failure that was in fact recorded, the same values must replay the
 * first answer instead of recording a second refund.
 */
export function refundKeyOf(
  store: RefundKeyStore,
  slot: string,
  request: unknown,
  make: () => string,
): string {
  const next = keyFor(store.get(slot) ?? null, JSON.stringify(request), make);
  store.set(slot, next);
  return next.key;
}

/** Refund keys held in a ref above the dialog; a key is dropped only on a confirmed success. */
export function useRefundKeys() {
  const store = useRef<RefundKeyStore>(new Map());
  const keyOf = useCallback(
    (invoiceId: string, source: RefundSource, request: unknown) =>
      refundKeyOf(store.current, refundSlot(invoiceId, source), request, () =>
        crypto.randomUUID(),
      ),
    [],
  );
  const drop = useCallback((invoiceId: string, source: RefundSource) => {
    store.current.delete(refundSlot(invoiceId, source));
  }, []);
  return useMemo(() => ({ keyOf, drop }), [keyOf, drop]);
}
