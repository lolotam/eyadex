import { useEffect, useRef, type PointerEvent } from "react";
import { DemoLink as DemoLinkInline } from "./demo-link";
import { useMk } from "./mk-context";
import { useReducedMotion } from "./motion/use-reduced-motion";
import { useScrollProgress } from "./motion/use-scroll-progress";

export function HeroRoom() {
  const { d } = useMk();
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const scrub = useRef({ target: 0, cur: 0, dur: 0, ready: false, raf: 0 });

  const tick = () => {
    const s = scrub.current;
    const v = video.current;
    s.raf = 0;
    if (!v || !s.ready) return;
    s.cur += (s.target - s.cur) * 0.12;
    if (!v.seeking && Math.abs(v.currentTime - s.cur) > 0.015) v.currentTime = s.cur;
    if (Math.abs(s.target - s.cur) > 0.004) s.raf = requestAnimationFrame(tick);
  };

  useScrollProgress(section, {
    disabled: reduced,
    onProgress: (p) => {
      const s = scrub.current;
      s.target = p * s.dur * 0.96;
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    },
  });

  useEffect(() => {
    const v = video.current;
    if (reduced || !v) return;
    const s = scrub.current;
    let gaveUp = false;
    let timer = 0;
    const onMeta = () => {
      s.dur = v.duration || 0;
      v.currentTime = 0.001;
    };
    const onSeeked = () => {
      if (s.ready || gaveUp) return;
      s.ready = true;
      window.clearTimeout(timer);
      stage.current?.classList.add("is-live");
    };
    const start = () => {
      v.addEventListener("loadedmetadata", onMeta);
      v.addEventListener("seeked", onSeeked);
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      v.preload = "auto";
      v.src = mobile ? "/marketing/hero-mobile.mp4" : "/marketing/hero-desktop.mp4";
      v.load();
      timer = window.setTimeout(() => {
        if (!s.ready) gaveUp = true;
      }, 3000);
    };
    const kick = () => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 2000 });
      else window.setTimeout(start, 200);
    };
    if (document.readyState === "complete") kick();
    else window.addEventListener("load", kick, { once: true });
    return () => {
      window.removeEventListener("load", kick);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("seeked", onSeeked);
      window.clearTimeout(timer);
    };
  }, [reduced]);

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    stage.current.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    stage.current.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };

  return (
    <section id="mk-hero" ref={section} className="mk-hero" aria-labelledby="mk-hero-h">
      <div ref={stage} className="mk-hero-stage" onPointerMove={onPointer}>
        <div className="mk-hero-media" aria-hidden="true">
          <div className="mk-hero-far">
            <picture>
              <source media="(max-width: 767px)" srcSet="/marketing/hero-mobile.webp" width={720} height={1280} />
              <img src="/marketing/hero-desktop.webp" alt="" width={1920} height={1080} fetchPriority="high" decoding="async" />
            </picture>
            <video ref={video} muted playsInline preload="none" tabIndex={-1} />
          </div>
          <div className="mk-hero-sun" />
          <img className="mk-hero-olive" src="/marketing/olive.webp" alt="" width={700} height={1054} decoding="async" />
        </div>
        <div className="mk-hero-door">
          <span className="mk-hero-stile" aria-hidden="true" />
          <span className="mk-hero-handle" aria-hidden="true" />
          <div className="mk-hero-copy">
            <h1 id="mk-hero-h" className="mk-display">{d.hero.h1}</h1>
            <p className="mk-lead">{d.hero.lead}</p>
            <div className="mk-actions">
              <DemoLinkInline />
              <a className="mk-link mk-link--strong" href="#keyring">{d.hero.secondary}</a>
            </div>
          </div>
        </div>
        <p className="mk-hero-beat">{d.hero.beat}</p>
      </div>
    </section>
  );
}
