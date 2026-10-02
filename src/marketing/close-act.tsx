import { useRef } from "react";
import { DemoLink } from "./demo-link";
import { useMk } from "./mk-context";
import { useReducedMotion } from "./motion/use-reduced-motion";
import { useScrollProgress } from "./motion/use-scroll-progress";
import { SITE } from "./site-config";

export function CloseAct() {
  const { d } = useMk();
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useScrollProgress(ref, { disabled: reduced, rest: 1 });
  return (
    <section ref={ref} className="mk-close" aria-labelledby="mk-close-h">
      <div className="mk-close-stage">
        <div className="mk-close-bed" aria-hidden="true">
          <img src="/marketing/close.webp" alt="" width={1920} height={1086} loading="lazy" decoding="async" />
        </div>
        <div className="mk-plate mk-close-plate">
          <h2 id="mk-close-h" className="mk-h2">{d.close.h2}</h2>
          <p className="mk-body">{d.close.p}</p>
          <div className="mk-actions">
            <DemoLink size="lg" />
            <span className="mk-email" dir="ltr">{SITE.email}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
