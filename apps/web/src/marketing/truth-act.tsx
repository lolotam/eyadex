import { useRef, type CSSProperties } from "react";
import { useMk } from "./mk-context";
import { useReducedMotion } from "./motion/use-reduced-motion";
import { useScrollProgress } from "./motion/use-scroll-progress";

const STARTS = [0.08, 0.34, 0.6];

export function TruthAct() {
  const { d } = useMk();
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useScrollProgress(ref, { disabled: reduced, rest: 1 });
  return (
    <section ref={ref} className="mk-truth" aria-labelledby="mk-truth-h">
      <div className="mk-truth-stage">
        <h2 id="mk-truth-h" className="mk-sr">
          {d.truth.h2}
        </h2>
        <div className="mk-truth-lines">
          {d.truth.lines.map((line, i) => (
            <p
              key={line}
              className="mk-truth-line"
              style={{ "--t": STARTS[i], "--tn": STARTS[i + 1] ?? 2 } as CSSProperties}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="mk-silence" aria-hidden="true" />
    </section>
  );
}
