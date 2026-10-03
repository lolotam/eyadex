import { describe, expect, it } from "vitest";

import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// CLASS 5 from the red-team report: a relative reference carries a reset or invite token without a scheme,
// so the old `scheme://`-only check never saw it. Query and fragment are always withheld; an opaque segment
// is replaced; under a URL-named key the whole path after the first segment is withheld.

describe("relative references", () => {
  it.each([
    ["/invite/tok_live_abcdef", "/invite/[REDACTED]", "tok_live_abcdef"],
    ["/reset?code=abc123secret", "/reset?[REDACTED]", "abc123secret"],
    ["//app.example/invite/tok_live_abcdef", "//app.example/invite/[REDACTED]", "tok_live_abcdef"],
    ["?key=abc123secret", "?[REDACTED]", "abc123secret"],
    ["?sig=abc123secret", "?[REDACTED]", "abc123secret"],
  ])("withholds the token in %s", (raw, expected, leak) => {
    const result = sanitize({ link: raw }) as { link: string };
    expect(result.link).not.toContain(leak);
    expect(result).toEqual({ link: expected });
  });

  it("withholds an opaque path segment under a neutral key too", () => {
    const result = sanitize({ path: "/api/v1/reset/tok_live_abcdef" }) as { path: string };
    expect(result.path).not.toContain("tok_live_abcdef");
    expect(result).toEqual({ path: "/api/v1/reset/[REDACTED]" });
  });

  it("replaces a long opaque segment (length >= 16)", () => {
    expect(sanitize({ note: "/x/abcdef0123456789" })).toEqual({ note: `/x/${REDACTED}` });
  });

  it("runs in audit snapshots too — an invite token never reaches the audit trail", () => {
    expect(redactSecrets({ link: "/invite/tok_live_abcdef" })).toEqual({
      link: "/invite/[REDACTED]",
    });
  });
});

describe("ordinary path segments are kept", () => {
  it.each(["/v1/health", "/clinic/patients", "/invite/:token", "/v1/patients/:id"])(
    "keeps %s under a neutral key",
    (raw) => {
      expect(sanitize({ path: raw })).toEqual({ path: raw });
    },
  );

  it("withholds the path after the first segment under a URL-named key", () => {
    expect(sanitize({ url: "/clinic/patients" })).toEqual({ url: "/clinic/[REDACTED]" });
    expect(sanitize({ url: "/v1/health" })).toEqual({ url: "/v1/[REDACTED]" });
  });

  it("treats callback as a URL-named key", () => {
    // Decision 5 lists `callback` among the URL-named keys: an OAuth callback is where a code hides.
    expect(sanitize({ callback: "/clinic/patients" })).toEqual({ callback: "/clinic/[REDACTED]" });
  });
});

describe("absolute URLs keep scheme, host and port only", () => {
  it("withholds a value in the path of an absolute URL", () => {
    const result = sanitize({ url: "https://app.example/invite/tok_live_abcdef" }) as {
      url: string;
    };
    expect(result.url).not.toContain("tok_live_abcdef");
    expect(result).toEqual({ url: "https://app.example/[REDACTED]" });
  });
});

describe("a relative reference embedded in free text is scanned in both modes", () => {
  it.each([
    [
      "invite sent to /invite/tok_live_abcdef1234 ok",
      "invite sent to /invite/[REDACTED] ok",
      "tok_live_abcdef1234",
    ],
    [
      "reset link /reset?code=abc123secret456 sent",
      "reset link /reset?[REDACTED] sent",
      "abc123secret456",
    ],
    [
      "sent /invite/tok_live_abc123 to the patient by sms",
      "sent /invite/[REDACTED] to the patient by sms",
      "tok_live_abc123",
    ],
  ])("withholds the token in %j", (raw, expected, leak) => {
    const sanitized = sanitize({ note: raw }) as { note: string };
    expect(sanitized.note).not.toContain(leak);
    expect(sanitized).toEqual({ note: expected });
    const audited = redactSecrets({ note: raw }) as { note: string };
    expect(audited.note).not.toContain(leak);
    expect(audited).toEqual({ note: expected });
  });
});

describe("ordinary prose with slashes stays readable", () => {
  it.each(["and/or", "3/4", "km/h", "03/10/2026", "patients/list"])("keeps %j", (raw) => {
    expect(sanitize({ note: raw })).toEqual({ note: raw });
  });
});

describe("numeric path codes and opaque hosts", () => {
  it.each([
    ["/reset/482193", "/reset/[REDACTED]"],
    ["/reset/123456789", "/reset/[REDACTED]"],
  ])("withholds a numeric code in %s", (raw, expected) => {
    expect(sanitize({ path: raw })).toEqual({ path: expected });
  });

  it("withholds a host that is itself opaque", () => {
    expect(sanitize({ url: "https://tok_live_abcdef1234.example.com/x" })).toEqual({
      url: "https://[REDACTED]/[REDACTED]",
    });
  });
});
