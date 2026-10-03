import { useEffect, useState, type RefObject } from "react";

/** Becomes true the first time the element enters the viewport, then stays true. */
export function useInViewOnce(
  ref: RefObject<HTMLElement | null>,
  rootMargin = "0px 0px -15% 0px",
): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}
