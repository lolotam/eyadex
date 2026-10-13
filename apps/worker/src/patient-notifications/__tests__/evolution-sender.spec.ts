import { describe, expect, it } from "vitest";

import {
  classifyEvolutionError,
  classifyEvolutionResponse,
  finalWhatsappError,
} from "../domain/evolution-failure.ts";
import { EvolutionWhatsappSender } from "../whatsapp/evolution-whatsapp-sender.ts";

// Evolution API v2.3.7 shapes (src/api/routes/sendMessage.router.ts, main.ts error handler). Fake number.
const NUMBER = "96500000001";

describe("classifyEvolutionResponse", () => {
  it("2xx with a message key → sent", () => {
    expect(classifyEvolutionResponse(201, { key: { id: "3EB0ABC", fromMe: true } })).toEqual({
      sent: true,
    });
  });

  it("2xx without a key → evo_rejected (the Business integration returns Meta's refusal as 201)", () => {
    const metaError = { message: "(#132000) Number of parameters does not match", code: 132000 };
    expect(classifyEvolutionResponse(201, metaError)).toEqual({
      sent: false,
      error: "evo_rejected",
    });
    expect(classifyEvolutionResponse(200, null)).toEqual({ sent: false, error: "evo_rejected" });
  });

  it.each([
    [
      401,
      { status: 401, error: "Unauthorized", response: { message: "Unauthorized" } },
      "evo_unauthorized",
    ],
    [403, null, "evo_unauthorized"],
    [
      404,
      { status: 404, error: "Not Found", response: { message: ["instance does not exist"] } },
      "evo_not_connected",
    ],
    [
      400,
      { status: 400, error: "Bad Request", response: { message: ["Error: Connection Closed"] } },
      "evo_not_connected",
    ],
    [
      400,
      {
        status: 400,
        error: "Bad Request",
        response: { message: [{ exists: false, jid: `${NUMBER}@s.whatsapp.net`, number: NUMBER }] },
      },
      "evo_not_on_whatsapp",
    ],
    [
      400,
      { status: 400, error: "Bad Request", response: { message: ["Text is required"] } },
      "evo_4xx",
    ],
    [500, { status: 500, error: "Internal Server Error" }, "evo_5xx"],
    [502, "not json", "evo_5xx"],
  ])("%i → %s", (status, body, error) => {
    expect(classifyEvolutionResponse(status, body)).toEqual({ sent: false, error });
  });

  it("a code never carries the number or the body", () => {
    const result = classifyEvolutionResponse(400, {
      response: { message: [{ exists: false, number: NUMBER }] },
    });
    expect(JSON.stringify(result)).not.toContain(NUMBER);
  });
});

describe("classifyEvolutionError", () => {
  it("the deadline → evo_timeout; anything else before a response → evo_unreachable", () => {
    expect(classifyEvolutionError(new DOMException("timed out", "TimeoutError"))).toBe(
      "evo_timeout",
    );
    expect(classifyEvolutionError(new DOMException("aborted", "AbortError"))).toBe("evo_timeout");
    expect(classifyEvolutionError(new TypeError("fetch failed"))).toBe("evo_unreachable");
    expect(classifyEvolutionError("weird")).toBe("evo_unreachable");
  });

  it("only a number that is not on WhatsApp is final", () => {
    expect(finalWhatsappError("evo_not_on_whatsapp")).toBe(true);
    for (const code of ["evo_timeout", "evo_unreachable", "evo_5xx", "evo_not_connected"]) {
      expect(finalWhatsappError(code)).toBe(false);
    }
  });
});

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("EvolutionWhatsappSender", () => {
  const options = { url: "http://evolution.internal.test:8080", apiKey: "test-only-key" };

  it("sendText posts {number, text} to /message/sendText/:instance with the apikey header", async () => {
    const { calls, fetch } = fakeFetch(() => json(201, { key: { id: "3EB0" } }));
    const sender = new EvolutionWhatsappSender({ ...options, fetch });
    expect(await sender.sendText("eyadex-clinic/1", NUMBER, "Hello")).toEqual({ sent: true });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(
      "http://evolution.internal.test:8080/message/sendText/eyadex-clinic%2F1",
    );
    expect(call!.init.method).toBe("POST");
    expect(call!.init.headers).toMatchObject({ apikey: "test-only-key" });
    expect(JSON.parse(String(call!.init.body))).toEqual({ number: NUMBER, text: "Hello" });
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
    expect(call!.init.redirect).toBe("error");
  });

  it("sendTemplate posts name, language and one body component with text parameters in order", async () => {
    const { calls, fetch } = fakeFetch(() => json(201, { key: { id: "wamid.1" } }));
    const sender = new EvolutionWhatsappSender({ ...options, fetch });
    const result = await sender.sendTemplate("eyadex-c", NUMBER, {
      name: "appointment_booked",
      language: "ar",
      parameters: ["A", "B", "C"],
    });
    expect(result).toEqual({ sent: true });
    expect(calls[0]!.url).toBe("http://evolution.internal.test:8080/message/sendTemplate/eyadex-c");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      number: NUMBER,
      name: "appointment_booked",
      language: "ar",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "A" },
            { type: "text", text: "B" },
            { type: "text", text: "C" },
          ],
        },
      ],
    });
  });

  it("a network failure is a code, never a throw", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const sender = new EvolutionWhatsappSender({ ...options, fetch });
    expect(await sender.sendText("i", NUMBER, "x")).toEqual({
      sent: false,
      error: "evo_unreachable",
    });
  });

  it("stops at the deadline with evo_timeout", async () => {
    const fetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof globalThis.fetch;
    const sender = new EvolutionWhatsappSender({ ...options, fetch, timeoutMs: 20 });
    expect(await sender.sendText("i", NUMBER, "x")).toEqual({ sent: false, error: "evo_timeout" });
  });

  it("a refusal is classified from the answer", async () => {
    const { fetch } = fakeFetch(() =>
      json(400, { status: 400, response: { message: [{ exists: false, number: NUMBER }] } }),
    );
    const sender = new EvolutionWhatsappSender({ ...options, fetch });
    expect(await sender.sendText("i", NUMBER, "x")).toEqual({
      sent: false,
      error: "evo_not_on_whatsapp",
    });
  });
});
