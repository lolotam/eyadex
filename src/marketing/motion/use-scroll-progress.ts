import { useEffect, useRef, type RefObject } from "react";

type Options = {
  /** "pin": 0..1 while a tall section scrolls past its sticky stage. "pass": 0..1 from entering to leaving the viewport. */
  mode?: "pin" | "pass";
  /** When true, no listener runs and `--p` is fixed at `rest`. */
  disabled?: boolean;
  rest?: number;
  onProgress?: (p: number) => void;
};

/** Writes `--p` (0..1) on the element from scroll position. rAF-throttled, passive, paused offscreen, no React re-render per frame. */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, opts: Options = {}) {
  const { mode = "pin", disabled = false, rest = 0 } = opts;
  const cb = useRef(opts.onProgress);
  cb.current = opts.onProgress;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (disabled) {
      el.style.setProperty("--p", String(rest));
      return;
    }
    let raf = 0;
    let visible = true;
    let last = -1;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const raw = mode === "pass" ? (vh - r.top) / (vh + r.height) : -r.top / Math.max(1, r.height - vh);
      const p = Math.min(1, Math.max(0, raw));
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      el.style.setProperty("--p", p.toFixed(4));
      cb.current?.(p);
    };
    const onScroll = () => {
      if (visible && !raf) raf = requestAnimationFrame(measure);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      measure();
    });
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, mode, disabled, rest]);
}
