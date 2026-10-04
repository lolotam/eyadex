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
    // The "@host" cut off by a "/" or a space: the password half is still withheld.
    ["//user:pw/rest@host/x", `//${REDACTED}/rest@host/x`],
    // A reference after a pair delimiter is scanned too.
    ["x,//user:pw@host", "x,//***@host"],
    // …and one glued to a word, which starts no token.
    ["prefix//user:pw@host", "prefix//***@host"],
    // …including a glued one whose "@host" was cut off by / ? or #.
    ["prefix//user:pw/rest@host", `prefix//${REDACTED}/rest@host`],
    ["prefix//user:pw?x@host", `prefix//${REDACTED}?x@host`],
    ["prefix//user:pw#x@host", `prefix//${REDACTED}#x@host`],
    // An odd run of slashes: an empty match on the first "//" must not skip the overlapping one.
    ["x ///user:pw@host", "x ///***@host"],
    ["a/b/////user:pw@host", "a/b/////***@host"],
    ["x ///user:pw/rest@host", `x ///${REDACTED}/rest@host`],
    // The catch-all passes run after the absolute one: a glued "//a:" must not delete the "://" it needs…
    ["x//a:https://user:pw@host/db", `x//${REDACTED}//***@host/${REDACTED}`],
    // …a scheme with no word boundary ("_", digits) is still caught by its "//"…
    ["_redis://user:pw@host:6379/0", "_redis://***@host:6379/0"],
    ["shard1_redis://user:pw@host/0", "shard1_redis://***@host/0"],
    // …and a complete userinfo behind a single slash too.
    ["x/user:pw@host", "x/***@host"],
    ["/user:pw@host", "/***@host"],
    // Cut at the LAST "@", like a URL parser: a password may contain "@".
    ["x/user:p@w@host", "x/***@host"],
    ["x/user:a@b@c@host", "x/***@host"],
    ["x/user@domain:pw@host", "x/***@host"],
    ["x/:pw@host", "x/***@host"],
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
    ["password==hunter2", `password==${REDACTED}`],
    // Just past any fixed bound, and runs broken by spaces.
    ["password====S3cretVal4", `password====${REDACTED}`],
    ["apiKey::::x9", `apiKey::::${REDACTED}`],
    ["password: :x9", `password: :${REDACTED}`],
    ["token: ==x9", `token: ==${REDACTED}`],
    ["password=:=:=x9", `password=:=:=${REDACTED}`],
    ["password:\n=x9", `password:\n=${REDACTED}`],
    // The 200-character name bound, pinned from both sides (ADR accepted risk 11): moving the bound for
    // performance must fail a test, not silently move the blind spot.
    [`${"x".repeat(192)}password=hunter2`, `${"x".repeat(192)}password=${REDACTED}`],
    [`${"x".repeat(193)}password=hunter2`, `${"x".repeat(193)}password=hunter2`],
    [`${"x".repeat(196)}token=abc123`, `${"x".repeat(196)}token=abc123`],
    ["token=YWJjZGVm==", `token=${REDACTED}`],
    ["note: password=hunter2", `note: password=${REDACTED}`],
    ["user=bob password=x y", `user=bob password=${REDACTED}`],
    ["accessToken=abc&x=1", `accessToken=${REDACTED}&x=1`],
    ["sid=s%3Aabc; Path=/", `sid=${REDACTED}; Path=/`],
  ])("%j", (raw, expected) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: expected });
  });
});

// Post-merge Codex review of PR #16: a non-credential "x is …" head swallowed the rest of the line, so a
// credential later on the same line was never read.
describe("prose after a non-credential head on the same line", () => {
  it.each([
    ["status is ok password is hunter2", `status is ok password is ${REDACTED}`],
    ["the job was done password is hunter2", `the job was done password is ${REDACTED}`],
    ["a is b token was abc", `a is b token was ${REDACTED}`],
    ["state: ok and password is s3cret", `state: ok and password is ${REDACTED}`],
    ["status is ok\npassword is hunter2", `status is ok\npassword is ${REDACTED}`],
    // The same dash/arrow/bar separators in English (they leaked before this PR too).
    ["password - hunter2", `password - ${REDACTED}`],
    ["password — correct horse, next", `password — ${REDACTED}, next`],
    ["token -> abc123def", `token -> ${REDACTED}`],
    ["apiKey | sk-xyz", `apiKey | ${REDACTED}`],
    ["password => hunter2", `password =${REDACTED}`],
  ])("%j", (raw, expected) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: expected });
  });

  it.each(["status is ok", "token is invalid", "password is too short", "it was a long day"])(
    "keeps %j",
    (raw) => {
      for (const out of both({ note: raw })) expect(out).toEqual({ note: raw });
    },
  );
});

describe("a malformed percent escape does not switch decoding off", () => {
  it.each([
    ["password%3Dhunter2%ZZ", `password=${REDACTED}`],
    ["100% done password%3Dsecret9", `100% done password=${REDACTED}`],
    ["password%253Dhunter2", `password=${REDACTED}`],
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

const capture = (): { logger: Logger; lines: () => string } => {
  let written = "";
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  return {
    logger: createLogger("info", { destination: sink, events: ["probe"] }),
    lines: () => written,
  };
};
const throwing = (property: string): object =>
  Object.defineProperty({}, property, {
    enumerable: true,
    get() {
      throw new Error("getter");
    },
  });

describe("a hostile log object cannot make a log call throw", () => {
  it.each([
    ["a nested req getter", { req: throwing("routeOptions") }],
    ["a nested res getter", { res: throwing("statusCode") }],
    [
      "a Proxy whose ownKeys trap throws",
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("keys");
          },
        },
      ),
    ],
  ])("%s", (_label, hostile) => {
    const { logger, lines } = capture();
    expect(() => logger.info(hostile, "probe")).not.toThrow();
    expect(JSON.parse(lines())).toMatchObject({ msg: "probe" });
  });

  // Deeper down, the hostile node alone is withheld; its siblings survive and the line stays an object
  // (failing closed with a string made pino print {"0":"[","1":"R",…}).
  it.each([
    ["at depth 2", (bad: object) => ({ a: { b: bad }, keep: 1 })],
    ["inside an array", (bad: object) => ({ list: [bad], keep: 1 })],
  ])("a throwing ownKeys Proxy %s", (_label, wrap) => {
    const bad = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("keys");
        },
      },
    );
    const { logger, lines } = capture();
    logger.info(wrap(bad), "probe");
    const line = JSON.parse(lines()) as Record<string, unknown>;
    expect(line).toMatchObject({ keep: 1, msg: "probe" });
    expect(line).not.toHaveProperty("0");
    expect(JSON.stringify(line)).toContain(REDACTED);
  });

  it("writes the line with a throwing top-level getter's value withheld", () => {
    const { logger, lines } = capture();
    const hostile = { ok: 1 };
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new Error("getter");
      },
    });
    expect(() => logger.info(hostile, "probe")).not.toThrow();
    expect(JSON.parse(lines())).toMatchObject({ ok: 1, boom: REDACTED, msg: "probe" });
  });
});
