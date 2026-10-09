# ADR-0025 — Page titles and descriptions follow the user's language

- Status: accepted (owner decision 2026-10-09)
- Date: 2026-10-09

## Context

Every app route built its head with `pageHead("<English title>", "<English description>")`
(`apps/web/src/shared/seo/page-head.ts`), so the browser tab title, `description`, `og:title` and
`og:description` stayed English while the page itself was Arabic. CLAUDE.md §7 requires every string to go
through i18n (ar + en). Only `/invite/$token` differed: it rendered both languages in one string
(`"<ar> · <en>"`) from `invite.metaTitle` / `invite.metaDescription`.

The user's language lives in browser storage (`eyadex:language`), and storage is read in effects only
(CLAUDE.md §7, SSR hydration). The server therefore cannot know the visitor's language when it renders the
head, and the client's first render must match it.

## Decision

1. **Dictionary entries.** Each app page has a `routes.<key>` entry with `title` and `description` in
   `ar-routes.ts` and `en-routes.ts` (which also hold the `nav` labels, moved out of `ar.ts` / `en.ts` to
   keep them under 300 lines). The `Dictionary` type keeps both languages in step. The full title is
   `<title> · Eyadex` in both languages; the brand stays in Latin letters, and the Arabic text uses
   "المراجع / المراجعون", never "المريض / المرضى".
2. **One call per route.** A route file spreads `...pageHead("<key>")`, which returns
   `staticData: { headKey }` and a `head()` built from the **Arabic** entry (the PRD's default language).
   The other head tags are unchanged: `og:type`, `twitter:card` and `robots: noindex,nofollow`.
3. **SSR emits Arabic.** The server and the client's first render both produce the Arabic head, so there
   is no hydration mismatch.
4. **One client effect.** `LocalizedPageHead` (`shared/seo/localized-page-head.tsx`), mounted once inside
   `I18nProvider` in `__root.tsx`, reads the deepest active match's `staticData.headKey` and rewrites
   `document.title` and the `description`, `og:title`, `og:description` meta contents in the active
   language. It runs when the language is read from storage, on every language switch, on every change of
   page, and whenever the router redraws its own head tags (it depends on the router's rendered title).
5. **Marketing pages are excluded.** `/` and `/en` own their language by URL and keep `marketingHead`;
   they have no `headKey`, so the effect leaves them alone.
6. `/invite/$token` uses the same mechanism; its bilingual head and the `invite.metaTitle` /
   `invite.metaDescription` keys are removed.

## Consequences

- A visitor who chose English sees the Arabic tab title for the moment between first paint and the effect
  (and, during client navigation, between the router's commit and the effect). The page body has the same
  behaviour already, since the language is read in an effect.
- Crawlers and link previews see the Arabic head. The app pages are `noindex,nofollow`, so this only
  affects link previews; the indexed marketing pages are unchanged.
- A new app route must name a `routes.<key>` entry; `shared/seo/page-head.test.ts` fails for any route
  (other than the marketing pages) without one, and for any key missing or empty in either language.
- Pages without a `headKey` (the not-found page) keep the root head (`Eyadex`).
