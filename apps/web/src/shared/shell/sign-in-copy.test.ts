import { describe, expect, it } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { Route as LoginRoute } from "@/routes/login";
import { signInCopy } from "./sign-in-copy";

const text = (dict: unknown, key: string): string =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict) as string;

// A real (HTTP) sign-in page must never present itself as a demo with a persona picker.
const DEMO_WORDING = /تجريبي|الشخصية|demo|persona|explore/i;

describe("sign-in card copy", () => {
  it.each(["clinic", "platform"] as const)(
    "the %s sign-in is never described as a demo",
    (area) => {
      const copy = signInCopy({ area });
      for (const dict of [ar, en]) {
        expect(text(dict, copy.body)).toBeTruthy();
        expect(text(dict, copy.body)).not.toMatch(DEMO_WORDING);
      }
    },
  );

  it("a host still loading reads as the clinic sign-in, not the demo", () => {
    expect(signInCopy({ area: undefined }).body).toBe("auth.clinicBody");
  });

  it("the mock build keeps its demo wording", () => {
    expect(signInCopy(null)).toEqual({ title: "app.name", body: "landing.body" });
  });

  it("the login page's description never calls it a demo, in either language", () => {
    for (const dict of [ar, en]) {
      expect(text(dict, "routes.login.description")).toBeTruthy();
      expect(text(dict, "routes.login.description")).not.toMatch(DEMO_WORDING);
    }
    const head = LoginRoute.options.head?.({} as never) as { meta?: { content?: string }[] };
    const descriptions = (head.meta ?? []).map((m) => m.content ?? "").join(" ");
    expect(descriptions).toContain(text(ar, "routes.login.description"));
    expect(descriptions).not.toMatch(DEMO_WORDING);
  });
});
