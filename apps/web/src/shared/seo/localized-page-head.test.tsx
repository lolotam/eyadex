import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { mkDicts } from "@/marketing/i18n";
import { ar } from "@/shared/i18n/ar";
import { pageHeadText } from "./page-head";

const LANGUAGE_KEY = "eyadex:language";

let mounted: Root | null = null;

async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    await router.load();
  });
  mounted = createRoot(document);
  await act(async () => {
    mounted?.render(<RouterProvider router={router} />);
  });
  return router;
}

const description = () =>
  document.head.querySelector('meta[name="description"]')?.getAttribute("content");
const ogTitle = () =>
  document.head.querySelector('meta[property="og:title"]')?.getAttribute("content");

afterEach(() => {
  if (mounted) act(() => mounted?.unmount());
  mounted = null;
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("localized page head", () => {
  it("shows the Arabic head by default", async () => {
    await renderAt("/login");
    const { title, description: text } = pageHeadText("login", "ar");
    await expect.poll(() => document.title).toBe(title);
    expect(description()).toBe(text);
  });

  it("shows the stored language once it is read", async () => {
    window.localStorage.setItem(LANGUAGE_KEY, "en");
    await renderAt("/login");
    const { title, description: text } = pageHeadText("login", "en");
    await expect.poll(() => document.title).toBe(title);
    expect(description()).toBe(text);
    expect(ogTitle()).toBe(title);
  });

  it("follows the language switch and keeps it across navigation", async () => {
    const router = await renderAt("/login");
    await expect.poll(() => document.title).toBe(pageHeadText("login", "ar").title);

    const toggle = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${ar.language.switch}"]`,
    );
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());
    await expect.poll(() => document.title).toBe(pageHeadText("login", "en").title);
    expect(description()).toBe(pageHeadText("login", "en").description);

    await act(async () => {
      await router.navigate({ to: "/forbidden" });
    });
    const forbidden = pageHeadText("forbidden", "en");
    await expect.poll(() => document.title).toBe(forbidden.title);
    expect(description()).toBe(forbidden.description);
  });

  it("leaves the marketing pages' own head alone", async () => {
    window.localStorage.setItem(LANGUAGE_KEY, "en");
    await renderAt("/");
    await expect.poll(() => document.title).toBe(mkDicts.ar.meta.title);
    expect(description()).toBe(mkDicts.ar.meta.description);
  });
});
