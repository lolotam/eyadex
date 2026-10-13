import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyMetaError, classifyMetaResponse, finalMetaError } from "../domain/meta-failure.ts";
import { MetaGraphSender } from "../whatsapp/meta-graph-sender.ts";

const credentials = { phoneNumberId: "10000", accessToken: randomBytes(24).toString("hex") };
const template = { name: "booking_ok", language: "ar", parameters: ["A", "B"] };
const number = "00000000000";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("Meta classification", () => {
  it.each([190, 10, 200, 299])("unauthorized code %s is final", (code) => {
    expect(classifyMetaResponse(400, { error: { code } })).toEqual({
      sent: false,
      error: "meta_unauthorized",
    });
  });
  it("HTTP 401 is unauthorized regardless of body", () =>
    expect(classifyMetaResponse(401, null)).toEqual({ sent: false, error: "meta_unauthorized" }));
  it.each([...Array.from({ length: 16 }, (_, i) => 132000 + i), 132068, 132069])(
    "template code %s",
    (code) => {
      expect(classifyMetaResponse(400, { error: { code } })).toEqual({
        sent: false,
        error: "meta_template",
      });
    },
  );
  it.each([4, 80007, 130429, 131048, 131056])("rate limited code %s", (code) => {
    expect(classifyMetaResponse(400, { error: { code } })).toEqual({
      sent: false,
      error: "meta_rate_limited",
    });
  });
  it("recognizes unreachable, timeouts, not-on-WhatsApp and server errors", () => {
    expect(classifyMetaResponse(400, { error: { code: 131026 } })).toEqual({
      sent: false,
      error: "meta_not_on_whatsapp",
    });
    expect(classifyMetaResponse(503, {})).toEqual({ sent: false, error: "meta_5xx" });
    expect(classifyMetaError(new DOMException("fixture", "TimeoutError"))).toBe("meta_timeout");
    expect(classifyMetaError(new DOMException("fixture", "AbortError"))).toBe("meta_timeout");
    expect(classifyMetaError(new TypeError("fixture"))).toBe("meta_unreachable");
    expect(classifyMetaError(null)).toBe("meta_unreachable");
  });
  it.each([132016, 132067, 132070, 199, 300, "190", undefined])(
    "unrecognized code %s is rejected",
    (code) => {
      expect(
        classifyMetaResponse(400, { error: { code, message: credentials.accessToken } }),
      ).toEqual({ sent: false, error: "meta_rejected" });
    },
  );
  it("success needs a bounded first message id and no error", () => {
    expect(classifyMetaResponse(200, { messages: [{ id: "wamid.fake" }] })).toEqual({
      sent: true,
      messageId: "wamid.fake",
    });
    for (const body of [
      null,
      {},
      { messages: [] },
      { messages: [{ id: "" }] },
      { messages: [{ id: "x".repeat(201) }] },
    ])
      expect(classifyMetaResponse(200, body)).toEqual({ sent: false, error: "meta_rejected" });
  });
  it("only rate limiting, unreachable and 5xx retry", () => {
    for (const code of ["meta_rate_limited", "meta_unreachable", "meta_5xx"])
      expect(finalMetaError(code)).toBe(false);
    for (const code of [
      "meta_timeout",
      "meta_template",
      "meta_not_on_whatsapp",
      "meta_unauthorized",
      "meta_rejected",
      "unknown",
    ])
      expect(finalMetaError(code)).toBe(true);
  });
});
describe("MetaGraphSender", () => {
  it("posts directly to Graph v22.0 with the fixed body parameter order", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = new MetaGraphSender({
      fetch: (async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return json(200, { messages: [{ id: "wamid.fake" }] });
      }) as typeof fetch,
    });
    expect(await sender.sendTemplate(credentials, number, template)).toEqual({
      sent: true,
      messageId: "wamid.fake",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v22.0/10000/messages");
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      messaging_product: "whatsapp",
      to: number,
      type: "template",
      template: {
        name: "booking_ok",
        language: { code: "ar" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "A" },
              { type: "text", text: "B" },
            ],
          },
        ],
      },
    });
  });
  it("timeout is final even while reading an accepted response", async () => {
    const timed = new MetaGraphSender({
      timeoutMs: 5,
      fetch: ((_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        })) as typeof fetch,
    });
    expect(await timed.sendTemplate(credentials, number, template)).toEqual({
      sent: false,
      error: "meta_timeout",
    });
    const response = {
      status: 200,
      json: async () => {
        throw new DOMException("fixture", "TimeoutError");
      },
    } as unknown as Response;
    const reading = new MetaGraphSender({ fetch: (async () => response) as typeof fetch });
    expect(await reading.sendTemplate(credentials, number, template)).toEqual({
      sent: false,
      error: "meta_timeout",
    });
  });
  it("unreachable is retryable and replies never echo provider messages", async () => {
    const unreachable = new MetaGraphSender({
      fetch: (async () => {
        throw new TypeError(credentials.accessToken);
      }) as typeof fetch,
    });
    expect(await unreachable.sendTemplate(credentials, number, template)).toEqual({
      sent: false,
      error: "meta_unreachable",
    });
    const rejected = new MetaGraphSender({
      fetch: (async () =>
        json(400, { error: { code: 999, message: credentials.accessToken } })) as typeof fetch,
    });
    expect(await rejected.sendTemplate(credentials, number, template)).toEqual({
      sent: false,
      error: "meta_rejected",
    });
  });
});
