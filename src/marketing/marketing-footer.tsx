import { Link } from "@tanstack/react-router";
import { Lockup } from "./lockup";
import { useMk } from "./mk-context";

export function MarketingFooter() {
  const { d } = useMk();
  return (
    <footer className="mk-footer">
      <div className="mk-wrap mk-footer-row">
        <Lockup />
        <span className="mk-soft">{d.footer.copyright}</span>
        <span className="mk-footer-links">
          <a className="mk-link" href={d.nav.otherHref}>{d.nav.otherLang}</a>
          <Link className="mk-link" to="/login">{d.nav.signIn}</Link>
        </span>
      </div>
    </footer>
  );
}
