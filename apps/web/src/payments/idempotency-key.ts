import { useCallback, useRef } from "react";

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

/** One key holder per open dialog: the dialog's content mounts on open, so each open starts fresh. */
export function useIdempotencyKey(): (request: unknown) => string {
  const held = useRef<KeyedRequest>(null);
  return useCallback((request: unknown) => {
    held.current = keyFor(held.current, JSON.stringify(request), () => crypto.randomUUID());
    return held.current.key;
  }, []);
}
