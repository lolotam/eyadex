import { describe, expect, it } from "vitest";

import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// CLASS 2 / 10 / 11 / 13 from the red-team report. These are free-text rules: the key ("note", "data",
// "detail") says nothing, so the value itself must be recognised. All rules marked "both modes" also apply
// to audit snapshots.

// The value as a plain string: JSON.stringify would escape Arabic/IDN, hiding an address that did leak.
const text = (value: string): string => (sanitize({ note: value }) as { note: string }).note;

describe("CLASS 2 — credentials written inside free text", () => {
  it("withholds a PEM block, ending line or not", () => {
    const full =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEApemBlockLeak\n-----END RSA PRIVATE KEY-----";
    const truncated = "-----BEGIN PRIVATE KEY-----\nMIIBleak";
    expect(text(full)).not.toContain("pemBlockLeak");
    expect(text(truncated)).not.toContain("MIIBleak");
    expect(redactSecrets({ note: truncated })).toEqual({ note: REDACTED });
  });

  it.each([
    ["AWS", "AKIAIOSFODNN7EXAMPLE", "using AKIAIOSFODNN7EXAMPLE to sign"],
    [
      "GCP",
      "AIzaSyD-abcdefghijklmnopqrstuvwxyz12345",
      "key AIzaSyD-abcdefghijklmnopqrstuvwxyz12345",
    ],
    ["Stripe", "sk_live_51H8xYzAbCdefGhIjKlMnOpQrStUv", "sk_live_51H8xYzAbCdefGhIjKlMnOpQrStUv"],
    [
      "GitHub",
      "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
      "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    ],
    ["Slack", "xoxb-123456789012-abcdefghijklmnop", "xoxb-123456789012-abcdefghijklmnop"],
    ["GitLab", "glpat-abcdefghijklmnopqrst", "glpat-abcdefghijklmnopqrst"],
  ])("withholds the %s provider key", (_provider, token, raw) => {
    expect(text(raw)).not.toContain(token);
  });
});

describe("CLASS 10 — email addresses", () => {
  it.each(["مستخدم@example.com", "user@مثال.كويت", "josé@example.com"])(
    "redacts %s in free text",
    (address) => {
      expect(text(`mail: ${address} now`)).not.toContain(address);
    },
  );

  it("redacts a percent-encoded address and a percent-encoded assignment", () => {
    expect(sanitize({ note: "mailto:user%40example.com" })).toEqual({ note: "mailto:[REDACTED]" });
    expect(sanitize({ note: "password%3Dhunter2" })).toEqual({ note: "password=[REDACTED]" });
  });

  it("redacts a percent-encoded civil ID", () => {
    expect(sanitize({ note: "%33%30%30%30%34%30%31%31%32%33%34%37" })).toEqual({
      note: REDACTED,
    });
  });
});

describe("CLASS 11 — JSON and metadata names inside a string", () => {
  it("redacts an escaped-JSON credential and a metadata-suffixed name", () => {
    expect(sanitize({ data: '{\\"password\\":\\"hunter2\\"}' })).not.toContain("hunter2");
    expect(sanitize({ data: '{"passwordValue":"hunter2"}' })).toEqual({
      data: '{"passwordValue":[REDACTED]}',
    });
  });
});

describe("CLASS 13 — CLI flags and prose", () => {
  it.each([
    ["run --password hunter2 now", "run --password [REDACTED] now"],
    ["the password is hunter2", "the password is [REDACTED]"],
    ["the token was abcdef123456", "the token was [REDACTED]"],
    ["the token abcdef123456 is used", "the token [REDACTED] is used"],
    ["authorizationCode=ac_leak&x=1", "authorizationCode=[REDACTED]&x=1"],
    ["--token xyz", "--token [REDACTED]"],
    ["--api-key xyz", "--api-key [REDACTED]"],
    ["--secret xyz", "--secret [REDACTED]"],
  ])("redacts %j", (raw, expected) => {
    expect(sanitize({ detail: raw })).toEqual({ detail: expected });
  });

  it("keeps prose with no assignment", () => {
    for (const raw of ["the token expired", "spin=3", "pinned: true"]) {
      expect(sanitize({ detail: raw })).toEqual({ detail: raw });
    }
  });

  it.each([
    ["password 'hunter two' rejected", "password [REDACTED] rejected"],
    ['password "hunter two" rejected', "password [REDACTED] rejected"],
    ["passwd 'x'", "passwd [REDACTED]"],
    ['pwd "x"', "pwd [REDACTED]"],
    ["api-key 'a b'", "api-key [REDACTED]"],
    ["rejected pin '4821'", "rejected pin [REDACTED]"],
    ["token was 'a b'", "token was [REDACTED]"],
    ["password is hunter two", "password is [REDACTED]"],
    ["password='hunter two'", "password=[REDACTED]"],
  ])("redacts the whole quoted or multi-word value in %j", (raw, expected) => {
    expect(sanitize({ detail: raw })).toEqual({ detail: expected });
    expect(redactSecrets({ detail: raw })).toEqual({ detail: expected });
  });
});

describe("CLASS 2/9 — tok_ and inv_ are opaque in free text, whatever key holds them", () => {
  it("redacts a tok_/inv_ value in a note, an array, a Set and an audit snapshot", () => {
    expect(sanitize({ note: "tok_live_abcdef1234567890" })).toEqual({ note: REDACTED });
    expect(sanitize({ parts: ["inv_9f8a7b6c5d4e3f2a1b0c"] })).toEqual({ parts: [REDACTED] });
    expect(sanitize({ s: new Set(["tok_live_abcdef1234567890"]) })).toEqual({ s: [REDACTED] });
    expect(redactSecrets({ note: "tok_live_abcdef1234567890" })).toEqual({ note: REDACTED });
  });

  it("uses the same vocabulary as URL segments and code values", () => {
    expect(sanitize({ link: "/invite/tok_live_abcdef1234" })).toEqual({
      link: "/invite/[REDACTED]",
    });
  });
});
