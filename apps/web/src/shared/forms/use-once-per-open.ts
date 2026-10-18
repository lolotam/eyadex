import { useEffect, useRef } from "react";

/**
 * Lessons 4.1/4.2: runs `init` once each time a dialog opens for `openKey` (null = closed). A
 * background refetch re-renders the dialog with new data, but never resets what the user typed.
 */
export function useOncePerOpen(openKey: string | null, init: () => void): void {
  const seen = useRef<string | null>(null);
  const latest = useRef(init);
  latest.current = init;
  useEffect(() => {
    if (openKey === null) {
      seen.current = null;
      return;
    }
    if (seen.current === openKey) return;
    seen.current = openKey;
    latest.current();
  }, [openKey]);
}
