import { useRef, type CSSProperties } from "react";
import { useMk } from "./mk-context";
import { useReducedMotion } from "./motion/use-reduced-motion";
import { useScrollProgress } from "./motion/use-scroll-progress";

/** Stage 1: the clinic outline. Stage 2: two branch wings. Stage 3: rooms and doors. */
const STAGES: { cls: string; paths: string[] }[] = [
  { cls: "s0", paths: ["M40 40 H560 V360 H40 Z"] },
  { cls: "s1", paths: ["M40 40 H200 V200 H40"] },
  { cls: "s2", paths: ["M300 40 V360", "M40 200 H120", "M480 200 H560"] },
  {
    cls: "s3",
    paths: [
      "M40 130 H200 V40", "M200 130 V200", "M120 200 H200 V360", "M120 280 H40",
      "M400 40 V150 H560", "M400 150 V210 H480", "M400 260 H560", "M400 260 V360",
      "M200 160 a20 20 0 0 1 20 -20", "M400 180 a20 20 0 0 0 -20 -20", "M280 360 a20 20 0 0 1 20 -20",
    ],
  },
];

export function PlanDrawing() {
  const { d } = useMk();
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useScrollProgress(ref, { disabled: reduced, rest: 1 });
  return (
    <section ref={ref} className="mk-plan" aria-labelledby="mk-plan-h">
      <div className="mk-plan-stage">
        <h2 id="mk-plan-h" className="mk-sr">{d.plan.h2}</h2>
        <svg className="mk-plan-svg" viewBox="0 0 600 400" role="presentation" aria-hidden="true">
          {STAGES.map((s) => (
            <g key={s.cls} className={`mk-draw ${s.cls}`}>
              {s.paths.map((p) => (
                <path key={p} d={p} pathLength={1} />
              ))}
            </g>
          ))}
        </svg>
        <div className="mk-plan-callouts">
          {d.plan.callouts.map((c, i) => (
            <div key={c.h} className={`mk-callout c${i + 1}`} style={{ "--i": i } as CSSProperties}>
              <h3>{c.h}</h3>
              <p>{c.b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
