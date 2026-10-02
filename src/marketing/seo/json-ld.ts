import { mkDicts, type MkLang } from "../i18n";
import { SITE } from "../site-config";

export function buildJsonLd(lang: MkLang) {
  const d = mkDicts[lang];
  const url = lang === "ar" ? `${SITE.url}/` : `${SITE.url}/en`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Eyadex", url: SITE.url, logo: `${SITE.url}/icon-512.png` },
      { "@type": "WebSite", name: "Eyadex", url, inLanguage: lang },
      {
        "@type": "SoftwareApplication",
        name: "Eyadex",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Clinic management",
        operatingSystem: "Web",
        areaServed: "KW",
        inLanguage: ["ar", "en"],
        description: d.meta.description,
        url,
      },
      {
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: d.faq.items.map((i) => ({
          "@type": "Question",
          name: i.q,
          acceptedAnswer: { "@type": "Answer", text: i.a },
        })),
      },
    ],
  };
}
