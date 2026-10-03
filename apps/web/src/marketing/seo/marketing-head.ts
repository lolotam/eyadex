import mkCss from "../marketing.css?url";
import { mkDicts, type MkLang } from "../i18n";
import { SITE } from "../site-config";
import { buildJsonLd } from "./json-ld";

export function marketingHead(lang: MkLang) {
  const d = mkDicts[lang];
  const url = lang === "ar" ? `${SITE.url}/` : `${SITE.url}/en`;
  const image = `${SITE.url}/og/og-${lang}.jpg`;
  return {
    meta: [
      { title: d.meta.title },
      { name: "description", content: d.meta.description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Eyadex" },
      { property: "og:locale", content: d.meta.locale },
      { property: "og:locale:alternate", content: d.meta.altLocale },
      { property: "og:url", content: url },
      { property: "og:title", content: d.meta.title },
      { property: "og:description", content: d.meta.description },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: d.meta.ogAlt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: d.meta.title },
      { name: "twitter:description", content: d.meta.description },
      { name: "twitter:image", content: image },
    ],
    links: [
      { rel: "stylesheet", href: mkCss },
      { rel: "canonical", href: url },
      { rel: "alternate", hrefLang: "ar-KW", href: `${SITE.url}/` },
      { rel: "alternate", hrefLang: "en", href: `${SITE.url}/en` },
      { rel: "alternate", hrefLang: "x-default", href: `${SITE.url}/` },
      {
        rel: "preload",
        as: "image",
        href: "/marketing/hero-desktop.webp",
        media: "(min-width: 768px)",
        fetchPriority: "high" as const,
      },
      {
        rel: "preload",
        as: "image",
        href: "/marketing/hero-mobile.webp",
        media: "(max-width: 767px)",
        fetchPriority: "high" as const,
      },
    ],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(buildJsonLd(lang)) }],
  };
}
