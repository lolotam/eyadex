import { Writable } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// Shapes a credential still reached a log line or an audit snapshot through after the red-team rounds
// (PR #16 Codex review): each is asserted in BOTH modes, because credentials are never audit-policy data.
const both = (value: unknown): [unknown, unknown] => [sanitize(value), redactSecrets(value)];

describe("a scheme-relative URL's authority is scrubbed like a parsed URL's", () => {
  it.each([
    ["//user:hunter2@localhost/path", "//***@localhost/path"],
    ["see //u:pw@db:5432/x now", "see //***@db:5432/x now"],
  ])("%j", (raw, expected) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: expected });
  });

  it("keeps an ordinary scheme-relative reference", () => {
    expect(sanitize({ note: "//cdn.example.com/a.js" })).toEqual({
      note: "//cdn.example.com/a.js",
    });
  });
});

describe("the Token authorization scheme, whatever its case", () => {
  it.each(["TOKEN abcdef", "Token abcdef", "tOkEn abcdef", "token abc123def"])("%j", (raw) => {
    for (const out of both({ note: raw })) expect(out).not.toEqual({ note: raw });
  });

  it("leaves the English word alone", () => {
    expect(sanitize({ note: "the token expired" })).toEqual({ note: "the token expired" });
  });
});

describe("an unquoted credential value is withheld up to the next pair delimiter", () => {
  it.each([
    ["password: correct horse battery staple", `password: ${REDACTED}`],
    ["apiKey=alpha beta gamma", `apiKey=${REDACTED}`],
    ["note: password=hunter2", `note: password=${REDACTED}`],
    ["user=bob password=x y", `user=bob password=${REDACTED}`],
    ["accessToken=abc&x=1", `accessToken=${REDACTED}&x=1`],
    ["sid=s%3Aabc; Path=/", `sid=${REDACTED}; Path=/`],
  ])("%j", (raw, expected) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: expected });
  });
});

describe("a malformed percent escape does not switch decoding off", () => {
  it.each([
    ["password%3Dhunter2%ZZ", `password=${REDACTED}`],
    ["100% done password%3Dsecret9", `100% done password=${REDACTED}`],
  ])("%j", (raw, expected) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: expected });
  });
});

describe("Map keys are classified as the string they print as", () => {
  it("redacts an object key whose string form is a credential name, in audit too", () => {
    const key = { toString: () => "password" };
    expect(redactSecrets({ m: new Map([[key, "hunter2"]]) })).toEqual({
      m: { password: REDACTED },
    });
  });

  it("survives a key whose toString() throws", () => {
    const key = {
      toString(): string {
        throw new Error("boom");
      },
    };
    expect(sanitize({ m: new Map([[key, "v"]]) })).toEqual({ m: { "[Unprintable]": "v" } });
  });
});

describe("a throwing top-level getter cannot make a log call throw", () => {
  it("writes the line with the getter's value withheld", () => {
    let written = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    const logger: Logger = createLogger("info", { destination: sink, events: ["probe"] });
    const hostile = { ok: 1 };
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new Error("getter");
      },
    });
    expect(() => logger.info(hostile, "probe")).not.toThrow();
    expect(JSON.parse(written)).toMatchObject({ ok: 1, boom: REDACTED, msg: "probe" });
  });
});
