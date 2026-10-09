import type { Language } from "@eyadex/contracts/common";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import type { Dictionary } from "@/shared/i18n/dictionary";

export type PageHeadKey = keyof Dictionary["routes"];

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The page's `routes.<key>` entry; the shell localizes the tab title from it (ADR-0025). */
    headKey?: PageHeadKey;
  }
}

const dictionaries: Record<Language, Dictionary> = { ar, en };

/** The page's tab title and description in one language; the title carries the brand suffix. */
export function pageHeadText(key: PageHeadKey, lang: Language) {
  const { title, description } = dictionaries[lang].routes[key];
  return { title: `${title} · Eyadex`, description };
}

/**
 * Route options for an app page's head. The server cannot know the visitor's language (it lives in
 * browser storage, read in effects only), so the rendered head is Arabic, the default language;
 * `LocalizedPageHead` rewrites it on the client from `staticData.headKey` (ADR-0025).
 */
export function pageHead(key: PageHeadKey) {
  const { title, description } = pageHeadText(key, "ar");
  return {
    staticData: { headKey: key },
    head: () => ({
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex,nofollow" },
      ],
    }),
  };
}
