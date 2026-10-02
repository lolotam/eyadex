import { CloseAct } from "./close-act";
import { CorridorAct } from "./corridor-act";
import { FaqAct } from "./faq-act";
import { HeroRoom } from "./hero-room";
import { mkDicts, type MkLang } from "./i18n";
import { KeyringAct } from "./keyring/keyring-act";
import { LanguageAct } from "./language-act";
import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";
import { MkContext } from "./mk-context";
import { PlanDrawing } from "./plan-drawing";
import { RoadmapAct } from "./roadmap-act";
import { TruthAct } from "./truth-act";

export function MarketingPage({ lang }: { lang: MkLang }) {
  const d = mkDicts[lang];
  return (
    <MkContext.Provider value={{ lang, d }}>
      <div className="mk mk-grain" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
        <a className="mk-skip" href="#mk-main">{d.nav.skip}</a>
        <MarketingNav />
        <main id="mk-main" tabIndex={-1}>
          <HeroRoom />
          <TruthAct />
          <KeyringAct />
          <PlanDrawing />
          <CorridorAct />
          <LanguageAct />
          <RoadmapAct />
          <FaqAct />
          <CloseAct />
        </main>
        <MarketingFooter />
      </div>
    </MkContext.Provider>
  );
}
