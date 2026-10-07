import { describe, expect, it } from "vitest";

import type { SmtpSettings } from "../../invitation-mail/mail/smtp-mail-sender.ts";
import { isPublicAddress } from "../domain/public-address.ts";
import { RealClinicSenderFactory } from "../mail/clinic-sender-factory.ts";

const message = {
  to: "admin@example.test",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  idempotencyKey: "0192aaaa-0000-7000-8000-000000000001",
};
const smtp = (host: string, port = 587) => ({
  kind: "smtp" as const,
  host,
  port,
  user: "mailer",
  password: "fake-password",
});

/** A factory whose DNS answers are fixed and whose transport creation is recorded, never used. */
function factory(answers: string[] | Error) {
  const created: SmtpSettings[] = [];
  const lookups: string[] = [];
  const senders = new RealClinicSenderFactory({
    lookup: async (host) => {
      lookups.push(host);
      if (answers instanceof Error) throw answers;
      return answers.map((address) => ({ address }));
    },
    createTransport: (settings) => {
      created.push(settings);
      return { sendMail: async () => ({}), close: () => undefined };
    },
  });
  return { senders, created, lookups };
}

describe("public address check (SSRF, ADR-0014)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("refuses %s", (address) => expect(isPublicAddress(address)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
});

describe("clinic SMTP sender factory", () => {
  it.each([
    ["a private answer", ["10.0.0.5"]],
    ["a mapped loopback answer", ["::ffff:127.0.0.1"]],
    ["one private answer among public ones", ["8.8.8.8", "192.168.0.10"]],
  ])("never connects for %s", async (_name, answers) => {
    const { senders, created } = factory(answers);
    const clinic = await senders.open(smtp("smtp.example.test"));
    expect(await clinic.sender.send(message)).toEqual({
      sent: false,
      error: "smtp_blocked_address",
    });
    expect(created).toHaveLength(0);
  });

  it("refuses a port outside the SMTP set without resolving the host", async () => {
    const { senders, created, lookups } = factory(["8.8.8.8"]);
    const clinic = await senders.open(smtp("smtp.example.test", 6379));
    expect(await clinic.sender.send(message)).toEqual({
      sent: false,
      error: "smtp_port_not_allowed",
    });
    expect([created.length, lookups.length]).toEqual([0, 0]);
  });

  it("a failed lookup is smtp_dns, with no connection", async () => {
    const { senders, created } = factory(new Error("ENOTFOUND smtp.example.test"));
    const clinic = await senders.open(smtp("smtp.example.test"));
    expect(await clinic.sender.send(message)).toEqual({ sent: false, error: "smtp_dns" });
    expect(created).toHaveLength(0);
  });

  it("pins a public answer and keeps the name for TLS", async () => {
    const { senders, created } = factory(["8.8.8.8"]);
    await senders.open(smtp("smtp.example.test", 465));
    expect(created).toEqual([
      {
        host: "8.8.8.8",
        port: 465,
        user: "mailer",
        password: "fake-password",
        servername: "smtp.example.test",
      },
    ]);
  });
});
