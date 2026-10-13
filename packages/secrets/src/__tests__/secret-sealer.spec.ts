import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SealOpenError, SecretSealer } from "../secret-sealer.ts";

// The invitation token crosses the outbox sealed (ADR-0006): only the same key AND the same event id open it.
const key = () => randomBytes(32).toString("base64");

describe("SecretSealer", () => {
  it("opens what it sealed, in the same context", () => {
    const sealer = new SecretSealer(key());
    expect(sealer.open(sealer.seal("raw-token", "event-1"), "event-1")).toBe("raw-token");
  });

  it("never carries the value in clear text", () => {
    const sealed = new SecretSealer(key()).seal("raw-token-value", "event-1");
    expect(sealed).not.toContain("raw-token-value");
  });

  it("a wrong key throws a typed error without the sealed value or secret", () => {
    expect.assertions(4);
    const secret = randomBytes(24).toString("hex");
    const sealed = new SecretSealer(key()).seal(secret, "event-1");
    try {
      new SecretSealer(key()).open(sealed, "event-1");
    } catch (error) {
      expect(error).toBeInstanceOf(SealOpenError);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(sealed);
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("NEGATIVE: refuses another context, another key, and a tampered body", () => {
    const k = key();
    const sealer = new SecretSealer(k);
    const sealed = sealer.seal("raw-token", "event-1");
    expect(() => sealer.open(sealed, "event-2")).toThrow(SealOpenError);
    expect(() => new SecretSealer(key()).open(sealed, "event-1")).toThrow(SealOpenError);
    const [v, iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      sealer.open([v, iv, flipped.toString("base64url"), tag].join("."), "event-1"),
    ).toThrow(SealOpenError);
  });

  it("NEGATIVE: refuses a truncated authentication tag", () => {
    const sealer = new SecretSealer(key());
    const [v, iv, body, tag] = sealer.seal("raw-token", "event-1").split(".");
    const short = Buffer.from(tag!, "base64url").subarray(0, 4).toString("base64url");
    expect(() => sealer.open([v, iv, body, short].join("."), "event-1")).toThrow(SealOpenError);
  });

  it.each(["", "broken", "v2.iv.body.tag", "v1..body.tag"])(
    "refuses a malformed seal with its own error type (%s)",
    (sealed) =>
      expect(() => new SecretSealer(key()).open(sealed, "event-1")).toThrow(SealOpenError),
  );

  it("refuses a key that is not 32 bytes", () => {
    expect(() => new SecretSealer(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
