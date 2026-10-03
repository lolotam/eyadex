import { useRef, type CSSProperties } from "react";
import { useMk } from "./mk-context";
import { useInViewOnce } from "./motion/use-in-view";
import { useReducedMotion } from "./motion/use-reduced-motion";
import { useScrollProgress } from "./motion/use-scroll-progress";

export function CorridorAct() {
  const { d } = useMk();
  const ref = useRef<HTMLElement>(null);
  const ledgerRef = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  const seen = useInViewOnce(ledgerRef);
  useScrollProgress(ref, { mode: "pass", disabled: reduced, rest: 0.5 });
  return (
    <section ref={ref} className="mk-corridor" aria-labelledby="mk-corridor-h">
      <div className="mk-corridor-bed" aria-hidden="true">
        <img
          src="/marketing/corridor.webp"
          alt=""
          width={1920}
          height={1086}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="mk-corridor-inner">
        <div className="mk-plate">
          <h2 id="mk-corridor-h" className="mk-h2">
            {d.corridor.h2}
          </h2>
          <p className="mk-body">{d.corridor.p}</p>
        </div>
        <div className="mk-ledger">
          <span className="mk-tag">{d.keyring.sample}</span>
          <ol ref={ledgerRef} className={seen ? "is-in" : undefined}>
            {d.corridor.ledger.map((l, i) => (
              <li key={l.time} style={{ "--i": i } as CSSProperties}>
                <time className="mk-num">{l.time}</time>
                <span>{l.who}</span>
                <span>{l.what}</span>
              </li>
            ))}
          </ol>
          <p className="mk-body">{d.corridor.isolation}</p>
          <p className="mk-body mk-soft">{d.corridor.subscription}</p>
        </div>
      </div>
    </section>
  );
}
