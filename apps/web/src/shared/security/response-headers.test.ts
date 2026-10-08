import { describe, expect, it } from "vitest";
import { areaHostsFrom } from "@/shared/api/area-host";
import { securityHeadersFor, withSecurityHeaders } from "./response-headers";

const staging = areaHostsFrom("staging-app.eyadex.com", "staging-platform.eyadex.com");

describe("web security headers (ADR-0021)", () => {
  it("never lets a page be sniffed into another type or leak its path to another origin", () => {
    for (const mode of ["mock", "http"] as const) {
      expect(securityHeadersFor("eyadex.com", mode, null)).toMatchObject({
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      });
    }
  });

  it("refuses framing where real sessions exist (http), not in the mock the editor previews", () => {
    expect(securityHeadersFor("staging-app.eyadex.com", "http", staging)).toMatchObject({
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    });
    const mock = securityHeadersFor("app.eyadex.com", "mock", null);
    expect(mock["x-frame-options"]).toBeUndefined();
    expect(mock["content-security-policy"]).toBeUndefined();
  });

  it("keeps the area hosts out of search engines, and only them", () => {
    expect(securityHeadersFor("staging-app.eyadex.com", "http", staging)["x-robots-tag"]).toBe(
      "noindex, nofollow",
    );
    expect(securityHeadersFor("platform.eyadex.com", "mock", null)["x-robots-tag"]).toBe(
      "noindex, nofollow",
    );
    expect(securityHeadersFor("eyadex.com", "http", null)["x-robots-tag"]).toBeUndefined();
  });

  it("adds them to a response whose own headers are immutable, keeping status and body", async () => {
    const redirect = Response.redirect("https://staging-app.eyadex.com/login", 307);
    const out = withSecurityHeaders(
      new Request("https://staging-app.eyadex.com/"),
      redirect,
      "http",
      staging,
    );
    expect(out.status).toBe(307);
    expect(out.headers.get("location")).toBe("https://staging-app.eyadex.com/login");
    expect(out.headers.get("x-frame-options")).toBe("DENY");
    const page = withSecurityHeaders(
      new Request("https://eyadex.com/"),
      new Response("<p>hi</p>", { status: 200, headers: { "content-type": "text/html" } }),
      "mock",
      null,
    );
    expect(await page.text()).toBe("<p>hi</p>");
    expect(page.headers.get("content-type")).toBe("text/html");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
