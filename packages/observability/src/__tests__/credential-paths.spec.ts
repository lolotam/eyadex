import { Writable } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { REDACTED, sanitize } from "../redaction.ts";

// Everything that reaches a log line as a credential rather than as a secret-named key: the keys that
// merely end in "key", and the URLs whose scheme looks harmless while their userinfo, path or query do
// not. Each case checks the final written line, not an intermediate object.
const capture = (log: (logger: Logger) => void): string => {
  let written = "";
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  log(createLogger("info", { destination: sink, events: ["event", "probe"] }));
  return written;
};

const SECRET = "tok_live_leak";

describe('credential keys that end in "key"', () => {
  it.each([
    "secret_key",
    "private_key",
    "encryption_key",
    "accessKey",
    "signing-key",
    "MASTER_KEY",
    "webhookKey",
    "passphrase",
    "hmac_key",
    "key",
  ])("the key %s is redacted", (key) => {
    expect(capture((log) => log.info({ [key]: SECRET }, "event"))).not.toContain(SECRET);
  });

  it('structural names ending in "key" are kept (sortKey, cacheKey, i18nKey)', () => {
    expect(
      JSON.parse(
        capture((log) => log.info({ sortKey: "name", cacheKey: "c1", i18nKey: "k" }, "event")),
      ),
    ).toMatchObject({ sortKey: "name", cacheKey: "c1", i18nKey: "k" });
  });
});

describe("URLs are parsed, not pattern-matched", () => {
  it("a password containing @ or whitespace does not leak its tail", () => {
    const raw = capture((log) =>
      log.info(
        {
          DATABASE_URL: "postgres://user:first@remaining_leak@db.example/app",
          other: "postgres://user:with space_leak@db.example/app",
        },
        "event",
      ),
    );
    expect(raw).not.toContain("remaining_leak");
    expect(raw).not.toContain("space_leak");
    expect(raw).toContain("db.example");
  });
});

describe("a URL keeps only scheme, host and port", () => {
  it("query strings are withheld — presigned signatures, tokens, api keys, bare tokens", () => {
    const raw = capture((log) =>
      log.info(
        {
          url: "https://storage.example/obj?X-Amz-Signature=sig_leak&X-Amz-Credential=cred_leak",
          callback: "see https://hooks.example/cb?token=tok_q_leak&api_key=key_q_leak for details",
          bare: "https://hooks.example/?bare_tok_leak",
        },
        "event",
      ),
    );
    for (const leak of ["sig_leak", "cred_leak", "tok_q_leak", "key_q_leak", "bare_tok_leak"]) {
      expect(raw).not.toContain(leak);
    }
    expect(raw).toContain("https://storage.example/[REDACTED]?[REDACTED]");
  });

  it("paths and fragments are withheld — invitation tokens, OAuth fragments, phone numbers", () => {
    const raw = capture((log) =>
      log.info(
        {
          invite: "https://app.example/invite/path_tok_leak",
          oauth: "https://app.example/callback#access_token=frag_tok_leak",
          sms: "https://sms.example/send/96550001234",
          root: "https://app.example/",
        },
        "event",
      ),
    );
    for (const leak of ["path_tok_leak", "frag_tok_leak", "96550001234"])
      expect(raw).not.toContain(leak);
    expect(raw).toContain("https://app.example/[REDACTED]#[REDACTED]");
    expect(raw).toContain('"root":"https://app.example/"');
  });

  it("an embedded URL with an ambiguous end, or an unparseable URL, keeps nothing of its credentials", () => {
    const raw = capture((log) =>
      log.info(
        {
          note: "connect postgres://user:with space_tail_leak@db.example/app now",
          broken: "postgres://user:pass/word_leak@db.example:99999/app",
          fine: "see https://user:pw_leak@db.example/app for details",
        },
        "event",
      ),
    );
    for (const leak of ["space_tail_leak", "word_leak", "pw_leak"]) expect(raw).not.toContain(leak);
    expect(raw).toContain("see https://***@db.example/[REDACTED] for details");
  });
});

describe("session credentials are secrets under any spelling", () => {
  it.each([
    "session",
    "sessionId",
    "session_id",
    "SESSION-ID",
    "userSession",
    "sid",
    "connect.sid",
  ])("%s", (key) => {
    expect(sanitize({ [key]: "s3cr3t-session-value" })).toEqual({ [key]: REDACTED });
  });

  it("does not catch ordinary words that merely end in 'sid'", () => {
    expect(sanitize({ inside: "ok", outside: "ok" })).toEqual({ inside: "ok", outside: "ok" });
  });
});

describe("credentials written inside free text are redacted whatever key holds them", () => {
  it.each([
    ["Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", `Bearer ${REDACTED}`],
    ["auth failed: Basic dXNlcjpwYXNzd29yZA==", `auth failed: Basic ${REDACTED}`],
    ["short Basic dTpw end", `short Basic ${REDACTED} end`],
    ["short Bearer abc123 end", `short Bearer ${REDACTED} end`],
    ["lower bearer x9 end", `lower bearer ${REDACTED} end`],
    ["upper BEARER abc123 end", `upper BEARER ${REDACTED} end`],
    ["mixed bAsIc dTpw end", `mixed bAsIc ${REDACTED} end`],
    ['Digest username="u", nonce="n", response="h"', `Digest ${REDACTED}`],
    [
      "line1\nAWS4-HMAC-SHA256 Credential=AK/x, Signature=abc\nline3",
      `line1\nAWS4-HMAC-SHA256 ${REDACTED}\nline3`,
    ],
    ["got eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl back", `got ${REDACTED} back`],
    ["retry with token=abc123def456", `retry with token=${REDACTED}`],
    ["accessToken=abc123def456&x=1", `accessToken=${REDACTED}&x=1`],
    ["password: hunter22", `password: ${REDACTED}`],
    ['x-api-key: "k3y-value-123"', `x-api-key: ${REDACTED}`],
    ["sid=s%3Aabc.def; Path=/", `sid=${REDACTED}; Path=/`],
    ["otp: 123456", `otp: ${REDACTED}`],
    ['password: "two words here"', `password: ${REDACTED}`],
    ["password='two words' next", `password=${REDACTED} next`],
    ['{"password": "a b c", "user": "x"}', `{"password": ${REDACTED}, "user": "x"}`],
    ["{'apiKey': 'k e y'}", `{'apiKey': ${REDACTED}}`],
  ])("%j", (text, redacted) => {
    expect(sanitize({ detail: text })).toEqual({ detail: redacted });
    expect(sanitize({ details: [text] })).toEqual({ details: [redacted] });
  });

  it.each(["pinned: true", "spin=3", "sessionCount=5", "the token expired", "Bearer"])(
    "leaves %j alone",
    (text) => {
      expect(sanitize({ detail: text })).toEqual({ detail: text });
    },
  );
});
