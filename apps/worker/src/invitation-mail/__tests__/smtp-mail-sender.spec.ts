import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";

import { SmtpMailSender, smtpErrorCode, type SmtpTransport } from "../mail/smtp-mail-sender.ts";

const message = {
  to: "invitee@example.test",
  subject: "Invitation",
  html: "<p>hello</p>",
  text: "hello",
  idempotencyKey: "0192aaaa-0000-7000-8000-000000000001",
};
const FROM = "Eyadex Team <no-reply@example.test>";

const failing = (error: unknown): SmtpTransport => ({
  sendMail: () => Promise.reject(error),
  close: () => undefined,
});

describe("SmtpMailSender", () => {
  it("maps the message onto the envelope: to, from, subject, html, text", async () => {
    const seen: unknown[] = [];
    const json = createTransport({ jsonTransport: true });
    const transport: SmtpTransport = {
      sendMail: async (mail) => {
        const info = await json.sendMail(mail);
        seen.push(JSON.parse(info.message));
        return info;
      },
      close: () => json.close(),
    };
    const result = await new SmtpMailSender(transport, FROM).send(message);
    expect(result).toEqual({ sent: true, provider: "smtp", fallback: false });
    expect(seen[0]).toMatchObject({
      from: { address: "no-reply@example.test", name: "Eyadex Team" },
      to: [{ address: "invitee@example.test" }],
      subject: "Invitation",
      html: "<p>hello</p>",
      text: "hello",
    });
  });

  it("sends through a streamTransport", async () => {
    const stream = createTransport({ streamTransport: true, buffer: true });
    const sender = new SmtpMailSender(stream as unknown as SmtpTransport, FROM);
    expect(await sender.send(message)).toEqual({ sent: true, provider: "smtp", fallback: false });
  });

  it.each([
    [{ code: "EAUTH", responseCode: 535 }, "smtp_auth"],
    [{ code: "ETIMEDOUT" }, "smtp_timeout"],
    [{ code: "ESOCKET", cause: { code: "ECONNREFUSED" } }, "smtp_econnrefused"],
    [{ code: "EENVELOPE", responseCode: 550 }, "smtp_550"],
    [{ code: "EDNS" }, "smtp_edns"],
    [{ code: "weird code with invitee@example.test" }, "smtp_error"],
    [null, "smtp_error"],
  ])("maps a transport error to a short code (%#)", async (shape, code) => {
    const error =
      shape === null ? null : Object.assign(new Error("550 invitee@example.test rejected"), shape);
    const result = await new SmtpMailSender(failing(error), FROM).send(message);
    expect(result).toEqual({ sent: false, error: code });
    expect(JSON.stringify(result)).not.toContain("example.test");
    expect(JSON.stringify(result)).not.toContain("rejected");
    expect(smtpErrorCode(error)).toBe(code);
  });

  it("gives up inside its budget with smtp_timeout", async () => {
    const hang: SmtpTransport = { sendMail: () => new Promise(() => {}), close: () => undefined };
    expect(await new SmtpMailSender(hang, FROM, 20).send(message)).toEqual({
      sent: false,
      error: "smtp_timeout",
    });
  });
});
