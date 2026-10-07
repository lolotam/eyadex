import { describe, expect, it } from "vitest";

import { formatAddress } from "../../invitation-mail/domain/mail-address.ts";
import { ResendMailSender } from "../../invitation-mail/mail/resend-mail-sender.ts";
import { SmtpMailSender, type SmtpTransport } from "../../invitation-mail/mail/smtp-mail-sender.ts";

const base = {
  to: "admin@example.test",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  idempotencyKey: "evt-1",
};
const clinic = {
  from: { name: "Clinic", address: "clinic@example.test" },
  replyTo: "desk@example.test",
};

describe("sender from/replyTo mapping (ADR-0014, 7c-2)", () => {
  const resend = () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return {
      bodies,
      sender: new ResendMailSender({ apiKey: "k", from: "Platform <p@example.test>", fetch }),
    };
  };

  it("Resend uses the clinic sender and reply_to when given", async () => {
    const { bodies, sender } = resend();
    await sender.send({ ...base, ...clinic });
    expect(bodies[0]).toMatchObject({
      from: '"Clinic" <clinic@example.test>',
      reply_to: ["desk@example.test"],
    });
  });

  it("Resend falls back to MAIL_FROM and sends no reply_to when absent", async () => {
    const { bodies, sender } = resend();
    await sender.send(base);
    expect(bodies[0]!.from).toBe("Platform <p@example.test>");
    expect(bodies[0]).not.toHaveProperty("reply_to");
  });

  it("SMTP puts the clinic sender and replyTo on the envelope, MAIL_FROM otherwise", async () => {
    const mails: Parameters<SmtpTransport["sendMail"]>[0][] = [];
    const transport: SmtpTransport = {
      sendMail: async (m) => void mails.push(m),
      close: () => undefined,
    };
    const sender = new SmtpMailSender(transport, "Platform <p@example.test>");
    await sender.send({ ...base, ...clinic });
    await sender.send(base);
    expect(mails[0]).toMatchObject({ from: clinic.from, replyTo: "desk@example.test" });
    expect(mails[1]!.from).toBe("Platform <p@example.test>");
    expect(mails[1]).not.toHaveProperty("replyTo");
  });

  it("a display name can never inject a header", () => {
    expect(formatAddress({ name: 'A"\r\nBcc: x', address: "a@example.test" })).toBe(
      '"A\\" Bcc: x" <a@example.test>',
    );
  });
});
