import { Writable } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// CLASS 15 / 16 from the red-team report: a sanitiser that throws is a sanitiser that gets bypassed, and
// bytes must never be walked as a numeric-index object.

describe("CLASS 15 — a hostile object cannot make the sanitiser throw", () => {
  it("replaces a property whose getter throws, and keeps walking the rest", () => {
    const boom: Record<string, unknown> = { safe: "ok" };
    Object.defineProperty(boom, "token", {
      enumerable: true,
      get() {
        throw new Error("getter boom");
      },
    });
    expect(sanitize({ x: boom })).toEqual({ x: { safe: "ok", token: REDACTED } });
  });

  it("returns REDACTED, never throws, when the walk itself fails", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("keys boom");
        },
      },
    );
    expect(() => sanitize(hostile)).not.toThrow();
    expect(sanitize(hostile)).toBe(REDACTED);
    expect(redactSecrets(hostile)).toBe(REDACTED);
  });
});

describe("CLASS 16 — buffers, typed arrays, Map and Set", () => {
  it("replaces a Buffer or typed array whole", () => {
    expect(sanitize({ raw: Buffer.from("50012345") })).toEqual({ raw: REDACTED });
    expect(sanitize({ raw: new Uint8Array([53, 48, 48, 49]) })).toEqual({ raw: REDACTED });
  });

  it("walks a Map as an object and applies the key rules to its string keys", () => {
    expect(sanitize({ m: new Map([["password", "hunter2"]]) })).toEqual({
      m: { password: REDACTED },
    });
    expect(sanitize({ m: new Map([["note", "hello"]]) })).toEqual({ m: { note: "hello" } });
  });

  it("walks a Set as an array", () => {
    expect(sanitize({ s: new Set([{ password: "hunter2" }]) })).toEqual({
      s: [{ password: REDACTED }],
    });
  });
});

describe("NIT 13/14 — own __proto__ and repeated siblings", () => {
  it("keeps an own __proto__ key and walks it instead of dropping it", () => {
    // A plain object's `out[key] = …` would set the prototype; a null-prototype result keeps it as a key.
    const input = JSON.parse('{"__proto__":{"password":"hunter2"},"note":"ok"}') as object;
    const result = sanitize(input);
    expect(JSON.parse(JSON.stringify(result))).toEqual(
      JSON.parse('{"__proto__":{"password":"[REDACTED]"},"note":"ok"}'),
    );
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("never prints an own __proto__ key through the real pino line", () => {
    // sanitize keeps the key (see above), but pino drops a __proto__ property while serialising, so the
    // written line must never contain the nested password. This pins the behaviour where it is observed.
    let written = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    const logger: Logger = createLogger("info", { destination: sink, events: ["probe"] });
    const input = JSON.parse('{"__proto__":{"password":"hunter2"},"note":"ok"}') as object;
    logger.info(input, "probe");
    expect(written).not.toContain("hunter2");
    expect(JSON.parse(written)).toMatchObject({ note: "ok", msg: "probe" });
  });

  it("walks a repeated sibling again, and labels only a true cycle [Circular]", () => {
    const shared = { password: "hunter2" };
    expect(sanitize({ a: shared, b: shared })).toEqual({
      a: { password: REDACTED },
      b: { password: REDACTED },
    });
    const loop: Record<string, unknown> = { label: "loop" };
    loop["self"] = loop;
    expect(sanitize(loop)).toEqual({ label: "loop", self: "[Circular]" });
  });
});

describe("CLASS 14 — the audit policy is explicit", () => {
  it("keeps names, emails and phones, but redacts credentials, PEM, civil IDs and URL tokens", () => {
    expect(
      redactSecrets({
        fullName: "SYNTHETIC NAME",
        email: "owner@example.invalid",
        phone: "+96500000001",
        civilId: "300000000000",
        passwordValue: "pw_leak",
        note: "-----BEGIN PRIVATE KEY-----\nMIIBleak",
        link: "/invite/tok_live_abcdef",
      }),
    ).toEqual({
      fullName: "SYNTHETIC NAME",
      email: "owner@example.invalid",
      phone: "+96500000001",
      civilId: REDACTED,
      passwordValue: REDACTED,
      note: REDACTED,
      link: "/invite/[REDACTED]",
    });
  });

  it("redacts a non-ASCII credential or mixed key in audit mode too", () => {
    expect(redactSecrets({ كلمة_المرور: "hunter2" })).toEqual({ كلمة_المرور: REDACTED });
    expect(redactSecrets({ صف: { كلمة_المرور: "hunter2" } })).toEqual({ صف: REDACTED });
    expect(redactSecrets({ user_كلمة: "hunter2" })).toEqual({ user_كلمة: REDACTED });
  });

  it("redacts a confusable non-ASCII key — the non-ASCII rule catches the homoglyph", () => {
    // "pаssword" with a Cyrillic "а". NFKC folds full-width forms but not confusables; the key still
    // contains a non-ASCII letter, so both modes replace it.
    expect(sanitize({ "p\u0430ssword": "hunter2" })).toEqual({ "p\u0430ssword": REDACTED });
    expect(redactSecrets({ "p\u0430ssword": "hunter2" })).toEqual({ "p\u0430ssword": REDACTED });
  });
});

describe("accepted risks (documented, not implemented)", () => {
  it("does not reassemble an identifier split across array items", () => {
    expect(sanitize({ parts: ["300040", "112347"] })).toEqual({ parts: ["300040", "112347"] });
  });

  it("does not treat a birth date under a neutral key as special", () => {
    expect(sanitize({ startedAt: "1990-01-01" })).toEqual({ startedAt: "1990-01-01" });
  });
});
