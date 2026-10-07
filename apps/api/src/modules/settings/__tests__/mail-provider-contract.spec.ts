import { mailProviderRequestSchema } from "@eyadex/contracts/mail-provider";
import { describe, expect, it } from "vitest";

const smtp = (host: string, port = 587) => ({
  kind: "smtp",
  host,
  port,
  user: "mailer",
  password: "fake-password",
  fromName: "Clinic",
  fromEmail: "clinic@example.test",
});

// Syntax only (ADR-0014): the worker's connect-time address check is the guard; this refuses the
// obvious internal targets before they are stored.
describe("SMTP provider request", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "[::1]",
    "::1",
    "localhost",
    "postgres",
    "mail.internal",
    "printer.local",
    "router.home.arpa",
  ])("refuses the host %s", (host) => {
    expect(mailProviderRequestSchema.safeParse(smtp(host)).success).toBe(false);
  });

  it.each([22, 80, 5432, 6379, 0])("refuses port %i", (port) => {
    expect(mailProviderRequestSchema.safeParse(smtp("smtp.example.test", port)).success).toBe(false);
  });

  it.each([
    ["smtp.example.test", 587],
    ["SMTP.Gmail.com", 465],
    ["mail.clinic-example.co", 25],
    ["relay.example.test", 2525],
  ])("accepts %s:%i", (host, port) => {
    const parsed = mailProviderRequestSchema.safeParse(smtp(host, port));
    expect(parsed.success).toBe(true);
  });
});
