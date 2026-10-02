import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fill } from "../i18n";
import { useMk } from "../mk-context";
import { useMedia } from "../motion/use-media";
import { useReducedMotion } from "../motion/use-reduced-motion";
import { useScrollProgress } from "../motion/use-scroll-progress";
import { buildCaption, computeView, KEY_ORDER, type KeyId } from "./keyring-model";
import { KeyringWindow } from "./keyring-window";

/** Admin, doctor, receptionist, technician share the first 60%; the team key owns the last 40%. */
function segmentFor(p: number): number {
  return p >= 0.6 ? 4 : Math.min(3, Math.floor(p / 0.15));
}

export function KeyringAct() {
  const { d, lang } = useMk();
  const k = d.keyring;
  const ref = useRef<HTMLElement>(null);
  const keyRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const desktop = useMedia("(min-width: 1024px)");
  const reduced = useReducedMotion();
  const [key, setKey] = useState<KeyId>("admin");
  const [ledger, setLedger] = useState<{ id: number; text: string }[]>([]);
  const seg = useRef(-1);
  const counter = useRef(0);

  const select = useCallback(
    (next: KeyId) => {
      setKey(next);
      const v = computeView(next);
      if (v.openFile === null) return;
      counter.current += 1;
      const line = { id: counter.current, text: fill(k.opened, { persona: k.keys[next], file: v.openFile }) };
      setLedger((l) => [line, ...l].slice(0, 4));
    },
    [k],
  );

  useScrollProgress(ref, {
    disabled: !desktop || reduced,
    onProgress: (p) => {
      const s = segmentFor(p);
      if (s === seg.current) return;
      seg.current = s;
      const nextKey = KEY_ORDER[s];
      if (nextKey) select(nextKey);
    },
  });

  const view = useMemo(() => computeView(key), [key]);
  const caption = buildCaption(view, k.caption, (b) => k.branches[b]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const handled = ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Home", "End"];
    if (!handled.includes(e.key)) return;
    e.preventDefault();
    const rtl = lang === "ar";
    let idx: number;
    if (e.key === "Home") idx = 0;
    else if (e.key === "End") idx = KEY_ORDER.length - 1;
    else {
      const next = e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight");
      const step = next ? 1 : -1;
      const focusedIndex = keyRefs.current.indexOf(e.target as HTMLButtonElement);
      const currentIndex = focusedIndex >= 0 ? focusedIndex : KEY_ORDER.indexOf(key);
      idx = (currentIndex + step + KEY_ORDER.length) % KEY_ORDER.length;
    }
    const nextKey = KEY_ORDER[idx];
    if (!nextKey) return;
    select(nextKey);
    keyRefs.current[idx]?.focus();
  };

  return (
    <section id="keyring" ref={ref} className="mk-keyring" aria-labelledby="mk-keyring-h">
      <div className="mk-keyring-stage">
        <header className="mk-keyring-head">
          <h2 id="mk-keyring-h" className="mk-h2">{k.h2}</h2>
          <p className="mk-body">{k.sub}</p>
        </header>
        <div className="mk-keyring-grid">
          <div className="mk-rail" role="radiogroup" aria-label={k.groupLabel} onKeyDown={onKeyDown}>
            {KEY_ORDER.map((id, i) => (
              <button
                key={id}
                ref={(el) => {
                  keyRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={key === id}
                tabIndex={key === id ? 0 : -1}
                className={`mk-key${key === id ? " is-on" : ""}`}
                onClick={() => select(id)}
              >
                <img src={`/marketing/key-${id}.webp`} alt="" width={226} height={520} loading="lazy" decoding="async" />
                <span>{k.keys[id]}</span>
              </button>
            ))}
          </div>
          <div className="mk-keyring-panel">
            <KeyringWindow view={view} />
            <p className="mk-caption" aria-live="polite">{caption}</p>
            <div className="mk-ledger-mini" aria-label={k.ledger}>
              <span className="mk-ledger-title">{k.ledger}</span>
              <ol>
                {ledger.map((l) => (
                  <li key={l.id}>{l.text}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
