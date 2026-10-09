import { QueryClient } from "@tanstack/react-query";
import { createRouter, type AnyRoute } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { lookup } from "@/shared/i18n/dictionary";
import { pageHeadText, type PageHeadKey } from "./page-head";

// The marketing pages own their language by URL and keep their own head (marketing/seo).
const OWN_HEAD = new Set(["__root__", "/", "/en"]);

const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
const pages = Object.values(router.routesById as unknown as Record<string, AnyRoute>).filter(
  (route) => !OWN_HEAD.has(route.id),
);
const headKeyOf = (route: AnyRoute) =>
  (route.options.staticData as { headKey?: PageHeadKey } | undefined)?.headKey;
const headOf = (route: AnyRoute) =>
  route.options.head?.({} as never) as { meta: { title?: string; content?: string }[] };

describe("page heads", () => {
  it("every app page names its head key", () => {
    expect(pages.length).toBeGreaterThan(15);
    for (const route of pages) expect(headKeyOf(route), route.id).toBeDefined();
  });

  it.each(pages.map((route) => [route.id, route] as const))(
    "%s has a title and description in Arabic and English",
    (_, route) => {
      const key = headKeyOf(route);
      for (const dict of [ar, en]) {
        expect(lookup(dict, `routes.${key}.title`)?.trim()).toBeTruthy();
        expect(lookup(dict, `routes.${key}.description`)?.trim()).toBeTruthy();
      }
      expect(lookup(ar, `routes.${key}.title`)).not.toBe(lookup(en, `routes.${key}.title`));
    },
  );

  it.each(pages.map((route) => [route.id, route] as const))(
    "%s renders the Arabic head on the server",
    (_, route) => {
      const key = headKeyOf(route) as PageHeadKey;
      const { title, description } = pageHeadText(key, "ar");
      const meta = headOf(route).meta;
      expect(meta.find((m) => m.title)?.title).toBe(title);
      expect(title.endsWith(" · Eyadex")).toBe(true);
      expect(meta.map((m) => m.content)).toContain(description);
      expect(meta.map((m) => m.content)).toContain("noindex,nofollow");
    },
  );

  it("follows the product vocabulary", () => {
    const arabic = JSON.stringify(ar.routes);
    expect(arabic).not.toMatch(/المريض|المرضى|كاشير/);
    expect(JSON.stringify(en.routes)).not.toMatch(/cashier/i);
    for (const dict of [ar, en]) {
      for (const key of Object.keys(dict.routes) as PageHeadKey[]) {
        expect(pageHeadText(key, dict === ar ? "ar" : "en").title).toMatch(/ · Eyadex$/);
      }
    }
  });
});
