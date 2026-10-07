import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ResendMailSender } from "../mail/resend-mail-sender.ts";

// A local stub stands in for api.resend.com: the real API is never called from a test.
let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const stub = async (status: number, body: string) => {
  const seen: { headers: IncomingHttpHeaders; body: string; url: string }[] = [];
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += String(chunk)));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: data, url: req.url ?? "" });
      res.writeHead(status, { "content-type": "application/json" }).end(body);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { seen, baseUrl: `http://127.0.0.1:${port}` };
};

const message = {
  to: "invitee@example.test",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  idempotencyKey: "0192aaaa-0000-7000-8000-000000000001",
};

describe("ResendMailSender", () => {
  it("posts /emails with the key, the idempotency header and the message", async () => {
    const { seen, baseUrl } = await stub(200, '{"id":"x"}');
    const sender = new ResendMailSender({
      apiKey: "test-only",
      from: "Eyadex Team <no-reply@example.test>",
      baseUrl,
    });
    expect(await sender.send(message)).toEqual({ sent: true, provider: "resend", fallback: false });
    expect(seen[0]!.url).toBe("/emails");
    expect(seen[0]!.headers["idempotency-key"]).toBe(message.idempotencyKey);
    expect(seen[0]!.headers.authorization).toBe("Bearer test-only");
    expect(JSON.parse(seen[0]!.body)).toEqual({
      from: "Eyadex Team <no-reply@example.test>",
      to: ["invitee@example.test"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
  });

  it("maps a provider error to a retryable code without the response body", async () => {
    const { baseUrl } = await stub(
      422,
      '{"name":"validation_error","message":"invitee@example.test is bad"}',
    );
    const sender = new ResendMailSender({ apiKey: "k", from: "f", baseUrl });
    const result = await sender.send(message);
    expect(result).toEqual({ sent: false, error: "resend_422:validation_error" });
    expect(JSON.stringify(result)).not.toContain("example.test");
  });

  it("maps a 500 and an unreachable host to codes", async () => {
    const { baseUrl } = await stub(500, "oops");
    expect(await new ResendMailSender({ apiKey: "k", from: "f", baseUrl }).send(message)).toEqual({
      sent: false,
      error: "resend_500",
    });
    const down = new ResendMailSender({ apiKey: "k", from: "f", baseUrl: "http://127.0.0.1:1" });
    expect(await down.send(message)).toEqual({ sent: false, error: "resend_network" });
  });
});

describe("ResendMailSender fetch failures (ADR-0014)", () => {
  const rejecting = (cause: unknown) =>
    new ResendMailSender({
      apiKey: "k",
      from: "f",
      fetch: () => Promise.reject(new TypeError("fetch failed", { cause })),
    });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])("%s → resend_unreachable", async (code) => {
    expect(await rejecting({ code }).send(message)).toEqual({
      sent: false,
      error: "resend_unreachable",
    });
  });

  it.each([{ code: "ECONNRESET" }, { code: "UND_ERR_SOCKET" }, undefined])(
    "any other cause → resend_network (%#)",
    async (cause) => {
      expect(await rejecting(cause).send(message)).toEqual({
        sent: false,
        error: "resend_network",
      });
    },
  );
});
