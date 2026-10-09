import { useEffect } from "react";
import { useMatches } from "@tanstack/react-router";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { pageHeadText, type PageHeadKey } from "./page-head";

function setMetaContent(selector: string, content: string) {
  document.head.querySelector(selector)?.setAttribute("content", content);
}

/**
 * Puts the active page's tab title and description in the user's language (ADR-0025). The router
 * renders the Arabic head; this rewrites it once the language is known and whenever it changes.
 * A page without `headKey` (the marketing pages, which own their language by URL) is left alone.
 */
export function LocalizedPageHead() {
  const { lang } = useI18n();
  const { headKey, routerTitle } = useMatches({
    select: (matches) => {
      let key: PageHeadKey | undefined;
      let title: string | undefined;
      // The deepest page wins, as in the router's own head.
      for (const match of matches) {
        key = match.staticData.headKey ?? key;
        title = match.meta?.find((tag) => tag?.title)?.title ?? title;
      }
      return { headKey: key, routerTitle: title };
    },
    structuralSharing: true,
  });

  // `routerTitle` is a dependency on purpose: whenever the router redraws its own (Arabic) head
  // tags, the rewrite has to run again after them.
  useEffect(() => {
    if (!headKey) return;
    const { title, description } = pageHeadText(headKey, lang);
    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
  }, [headKey, lang, routerTitle]);

  return null;
}
