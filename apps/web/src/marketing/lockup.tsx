import { useMk } from "./mk-context";

export function Lockup() {
  const { d, lang } = useMk();
  return (
    <a className="mk-lockup" href={lang === "ar" ? "/" : "/en"} aria-label={d.nav.home} dir="ltr">
      <img src="/brand/eyadex-mark.svg" alt="" width={20} height={27} />
      <span>Eyadex</span>
    </a>
  );
}
