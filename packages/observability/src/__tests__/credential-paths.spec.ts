import { Writable } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";

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
