import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { DemoLink } from "./demo-link";
import { Lockup } from "./lockup";
import { useMk } from "./mk-context";

export function MarketingNav() {
  const { d } = useMk();
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("mk-hero");
    if (!hero) return;
    const io = new IntersectionObserver(([e]) => setSolid(!e?.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  return (
    <header className={`mk-nav${solid ? " is-solid" : ""}`}>
      <div className="mk-nav-row">
        <Lockup />
        <nav className="mk-nav-end" aria-label="Eyadex">
          <a className="mk-link mk-hide-sm" href={d.nav.otherHref} hrefLang={d.nav.otherHref === "/" ? "ar" : "en"}>
            {d.nav.otherLang}
          </a>
          <Link className="mk-link mk-hide-sm" to="/login">
            {d.nav.signIn}
          </Link>
          <DemoLink />
          <button
            type="button"
            className="mk-icon-btn mk-show-sm"
            aria-label={d.nav.menu}
            aria-expanded={open}
            aria-controls="mk-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </nav>
      </div>
      {open && (
        <div id="mk-menu" className="mk-menu mk-show-sm">
          <a className="mk-link" href={d.nav.otherHref}>
            {d.nav.otherLang}
          </a>
          <Link className="mk-link" to="/login">
            {d.nav.signIn}
          </Link>
        </div>
      )}
    </header>
  );
}
