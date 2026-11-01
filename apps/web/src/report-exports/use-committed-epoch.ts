import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * An actor epoch that advances only when a render for a new scope commits. A speculative render
 * (transition or Suspense) for another actor that React abandons leaves the committed actor's
 * callbacks current; a committed A→B→A still yields a fresh epoch for the second A.
 */
export function useCommittedEpoch(scope: string) {
  const committed = useRef({ scope, epoch: 0 });
  const epoch =
    committed.current.scope === scope ? committed.current.epoch : committed.current.epoch + 1;
  useLayoutEffect(() => {
    if (committed.current.scope !== scope || committed.current.epoch !== epoch)
      committed.current = { scope, epoch };
  }, [scope, epoch]);
  const isCurrent = useCallback((value: number) => committed.current.epoch === value, []);
  return { epoch, isCurrent };
}
