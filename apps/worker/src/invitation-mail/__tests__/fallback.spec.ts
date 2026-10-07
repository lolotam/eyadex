import { describe, expect, it } from "vitest";

import { decideFallback } from "../domain/fallback-decision.ts";
import { FallbackMailSender } from "../mail/fallback-mail-sender.ts";
import type { MailMessage, MailResult, MailSender } from "../ports/mail-sender.ts";

const message: MailMessage = {
  to: "invitee@example.test",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  idempotencyKey: "0192aaaa-0000-7000-8000-000000000001",
};

class Fake implements MailSender {
  calls = 0;
  constructor(readonly result: MailResult) {}
  async send(): Promise<MailResult> {
    this.calls += 1;
    return this.result;
  }
}

const fail = (error: string): MailResult => ({ sent: false, error });

describe("decideFallback (ADR-0014)", () => {
  it.each(["resend_500", "resend_503", "resend_599", "resend_unreachable"])(
    "%s → try_secondary",
    (code) => expect(decideFallback(code)).toBe("try_secondary"),
  );

  it.each([
    "resend_timeout",
    "resend_network",
    "resend_429",
    "resend_422:validation_error",
    "resend_401",
    "resend_5000",
    "smtp_500",
  ])("%s → retry_primary", (code) => expect(decideFallback(code)).toBe("retry_primary"));
});

describe("FallbackMailSender", () => {
  it("never calls the secondary when the primary sends", async () => {
    const primary = new Fake({ sent: true, provider: "resend", fallback: false });
    const secondary = new Fake({ sent: true, provider: "smtp", fallback: false });
    const result = await new FallbackMailSender(primary, secondary, decideFallback).send(message);
    expect(result).toEqual({ sent: true, provider: "resend", fallback: false });
    expect(secondary.calls).toBe(0);
  });

  it("falls back on resend_500 and reports smtp + fallback", async () => {
    const secondary = new Fake({ sent: true, provider: "smtp", fallback: false });
    const sender = new FallbackMailSender(new Fake(fail("resend_500")), secondary, decideFallback);
    expect(await sender.send(message)).toEqual({ sent: true, provider: "smtp", fallback: true });
    expect(secondary.calls).toBe(1);
  });

  it("joins both codes when both fail, capped at 120 chars", async () => {
    const sender = new FallbackMailSender(
      new Fake(fail("resend_unreachable")),
      new Fake(fail("smtp_auth")),
      decideFallback,
    );
    expect(await sender.send(message)).toEqual({
      sent: false,
      error: "resend_unreachable;smtp_auth",
    });
    const long = new FallbackMailSender(
      new Fake(fail(`resend_500:${"a".repeat(64)}`)),
      new Fake(fail(`smtp_${"b".repeat(80)}`)),
      decideFallback,
    );
    const result = await long.send(message);
    expect(!result.sent && result.error.length).toBe(120);
  });

  it.each(["resend_timeout", "resend_429", "resend_network"])(
    "never calls the secondary on %s",
    async (code) => {
      const secondary = new Fake({ sent: true, provider: "smtp", fallback: false });
      const sender = new FallbackMailSender(new Fake(fail(code)), secondary, decideFallback);
      expect(await sender.send(message)).toEqual(fail(code));
      expect(secondary.calls).toBe(0);
    },
  );
});
