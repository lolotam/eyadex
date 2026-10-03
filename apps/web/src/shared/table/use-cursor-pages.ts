import { useCallback, useState } from "react";

/** Keeps a stack of cursors so a server-style cursor list can go back as well as forward. */
export function useCursorPages() {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack[stack.length - 1] ?? null;
  const next = useCallback((nextCursor: string | null) => {
    if (nextCursor) setStack((s) => [...s, nextCursor]);
  }, []);
  const previous = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback(() => setStack([null]), []);
  return { cursor, canPrevious: stack.length > 1, next, previous, reset };
}
