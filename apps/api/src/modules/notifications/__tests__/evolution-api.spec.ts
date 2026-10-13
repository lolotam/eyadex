import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { ServiceUnavailableError } from "../../../shared/errors.ts";
import { evolutionApiFromEnv } from "../persistence/evolution-config.ts";
import { HttpEvolutionApi, UnconfiguredEvolutionApi } from "../persistence/http-evolution-api.ts";

// A shaped placeholder, never a real key; the assertions check it never leaves the header.
const KEY = randomBytes(24).toString("hex");
const WEBHOOK_SECRET = randomBytes(32).toString("hex");
const HOOK = {
  webhookUrl: "http://eyadex-api:3001/v1/hooks/evolution",
  webhookSecret: WEBHOOK_SECRET,
};
const ENV = { EVOLUTION_WEBHOOK_URL: HOOK.webhookUrl, EVOLUTION_WEBHOOK_SECRET: WEBHOOK_SECRET };
const NAME = "eyadex-0190a000-0000-7000-8000-0000000000aa";
const QR = "data:image/png;base64,iVBORw0KGgo=";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An adapter over a scripted fetch: one answer per call, every request recorded. */
function scripted(...answers: (Response | Error)[]) {
  const seen: Seen[] = [];
  const fetchImpl = ((input: URL, init: RequestInit) => {
    seen.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const next = answers.shift();
    if (next === undefined) throw new Error("unexpected call");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof fetch;
  const api = new HttpEvolutionApi(
    { baseUrl: new URL("http://evolution:8080"), apiKey: KEY, ...HOOK },
    fetchImpl,
  );
  return { api, seen };
}

describe("evolutionApiFromEnv (spec §7.1)", () => {
  it("is unconfigured when both variables are unset", () => {
    const api = evolutionApiFromEnv({});
    expect(api).toBeInstanceOf(UnconfiguredEvolutionApi);
    expect(api.configured).toBe(false);
  });

  it("stops the start naming the missing variable, never echoing the other's value", () => {
    expect(() => evolutionApiFromEnv({ EVOLUTION_API_KEY: KEY })).toThrow(/EVOLUTION_API_URL/);
    expect(() => evolutionApiFromEnv({ EVOLUTION_API_URL: "http://evolution:8080" })).toThrow(
      /EVOLUTION_API_KEY/,
    );
    try {
      evolutionApiFromEnv({ EVOLUTION_API_KEY: KEY });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(KEY);
    }
  });

  it("refuses a URL that is not a plain http(s) origin", () => {
    for (const url of [
      "evolution:8080",
      "ftp://evolution",
      "http://user:pw@evolution:8080",
      "http://evolution:8080/api",
      "http://evolution:8080/?x=1",
    ]) {
      expect(() => evolutionApiFromEnv({ EVOLUTION_API_URL: url, EVOLUTION_API_KEY: KEY })).toThrow(
        /EVOLUTION_API_URL/,
      );
    }
  });

  it("builds the HTTP adapter when both are set", () => {
    const api = evolutionApiFromEnv({
      EVOLUTION_API_URL: "http://evolution:8080",
      EVOLUTION_API_KEY: KEY,
      ...ENV,
    });
    expect(api).toBeInstanceOf(HttpEvolutionApi);
    expect(api.configured).toBe(true);
  });

  it("requires both webhook variables with Evolution and forbids them without it", () => {
    const evolution = { EVOLUTION_API_URL: "http://evolution:8080", EVOLUTION_API_KEY: KEY };
    expect(() => evolutionApiFromEnv(evolution)).toThrow(/EVOLUTION_WEBHOOK_URL/);
    expect(() =>
      evolutionApiFromEnv({ ...evolution, EVOLUTION_WEBHOOK_URL: HOOK.webhookUrl }),
    ).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
    expect(() =>
      evolutionApiFromEnv({ ...evolution, ...ENV, EVOLUTION_WEBHOOK_SECRET: "x".repeat(31) }),
    ).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
    expect(() => evolutionApiFromEnv({ EVOLUTION_WEBHOOK_URL: HOOK.webhookUrl })).toThrow(
      /EVOLUTION_WEBHOOK_URL/,
    );
    expect(() => evolutionApiFromEnv({ EVOLUTION_WEBHOOK_SECRET: WEBHOOK_SECRET })).toThrow(
      /EVOLUTION_WEBHOOK_SECRET/,
    );
    for (const url of [
      "invalid",
      "ftp://internal/v1/hooks/evolution",
      "http://internal/other",
      "http://internal/v1/hooks/evolution?secret=x",
    ]) {
      expect(() =>
        evolutionApiFromEnv({ ...evolution, ...ENV, EVOLUTION_WEBHOOK_URL: url }),
      ).toThrow(/EVOLUTION_WEBHOOK_URL/);
    }
  });

  it("the unconfigured port answers 503 on every call", async () => {
    await expect(new UnconfiguredEvolutionApi().connect()).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});

describe("HttpEvolutionApi (Evolution v2 endpoints)", () => {
  it("uses 10 s for create and 5 s for other requests", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const { api } = scripted(json(201, {}), json(200, { count: 0 }));
      await api.createInstance(NAME);
      await api.connect(NAME);
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([10_000, 5_000]);
    } finally {
      timeout.mockRestore();
    }
  });
  it("creates a Baileys instance without waiting for a QR, the key in the apikey header only", async () => {
    const { api, seen } = scripted(json(201, { instance: { instanceName: NAME } }));
    expect(await api.createInstance(NAME)).toBe("created");
    expect(seen[0]).toMatchObject({
      url: "http://evolution:8080/instance/create",
      method: "POST",
      body: {
        instanceName: NAME,
        integration: "WHATSAPP-BAILEYS",
        qrcode: false,
        webhook: {
          enabled: true,
          url: HOOK.webhookUrl,
          byEvents: false,
          base64: false,
          headers: { "x-eyadex-webhook": WEBHOOK_SECRET },
          events: ["MESSAGES_UPDATE", "CONNECTION_UPDATE"],
        },
      },
    });
    expect(seen[0]!.headers["apikey"]).toBe(KEY);
    expect(JSON.stringify(seen[0]!.body)).not.toContain(KEY);
  });

  it("sets the webhook on existing instances", async () => {
    const { api, seen } = scripted(json(201, {}));
    await api.setWebhook(NAME);
    expect(seen[0]).toMatchObject({
      url: `http://evolution:8080/webhook/set/${NAME}`,
      body: {
        webhook: {
          enabled: true,
          url: HOOK.webhookUrl,
          byEvents: false,
          base64: false,
          headers: { "x-eyadex-webhook": WEBHOOK_SECRET },
          events: ["MESSAGES_UPDATE", "CONNECTION_UPDATE"],
        },
      },
    });
  });
  it("reads each connect answer: QR object, nested QR, open, missing", async () => {
    const { api, seen } = scripted(
      json(200, { pairingCode: null, code: "2@x", base64: QR, count: 1 }),
      json(200, { instance: { instanceName: NAME, status: "connecting" }, qrcode: { base64: QR } }),
      json(200, { pairingCode: null, code: "2@x", count: 0 }),
      json(200, { instance: { instanceName: NAME, state: "open" } }),
      json(404, { message: ["not found"] }),
    );
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: QR });
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: QR });
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: null });
    expect(await api.connect(NAME)).toEqual({ state: "open" });
    expect(await api.connect(NAME)).toEqual({ state: "missing" });
    expect(seen[0]!.url).toBe(`http://evolution:8080/instance/connect/${NAME}`);
  });

  it("normalizes bare base64 and keeps code-only or count-zero pending", async () => {
    const bare = QR.replace("data:image/png;base64,", "");
    const { api } = scripted(
      json(200, { base64: bare }),
      json(200, { qrcode: { base64: bare } }),
      json(200, { code: "fixture" }),
      json(200, { count: 0 }),
    );
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: QR });
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: QR });
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: null });
    expect(await api.connect(NAME)).toEqual({ state: "pending", qrDataUrl: null });
  });

  it("falls back to owner and strips device and domain suffixes", async () => {
    const { api } = scripted(
      json(200, [{ owner: "00000000001:12@s.whatsapp.net" }]),
      json(200, [{ ownerJid: "bad", owner: "00000000001" }]),
    );
    expect(await api.ownerLast4(NAME)).toBe("0001");
    expect(await api.ownerLast4(NAME)).toBe("0001");
  });

  it("reads the connection state and the last four digits of the owner", async () => {
    const { api, seen } = scripted(
      json(200, { instance: { instanceName: NAME, state: "open" } }),
      json(200, { instance: { instanceName: NAME } }),
      json(404, {}),
      json(200, [{ name: NAME, ownerJid: "96512345678@s.whatsapp.net" }]),
    );
    expect(await api.connectionState(NAME)).toBe("open");
    expect(await api.connectionState(NAME)).toBe("close");
    expect(await api.connectionState(NAME)).toBe("missing");
    expect(await api.ownerLast4(NAME)).toBe("5678");
    expect(seen[3]!.url).toBe(`http://evolution:8080/instance/fetchInstances?instanceName=${NAME}`);
  });

  it("treats logging out an unlinked or missing instance, and deleting a missing one, as done", async () => {
    const { api, seen } = scripted(json(400, {}), json(404, {}), json(200, {}), json(404, {}));
    await api.logout(NAME);
    await api.logout(NAME);
    await api.deleteInstance(NAME);
    await api.deleteInstance(NAME);
    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
      `DELETE /instance/logout/${NAME}`,
      `DELETE /instance/logout/${NAME}`,
      `DELETE /instance/delete/${NAME}`,
      `DELETE /instance/delete/${NAME}`,
    ]);
  });

  it("answers 503 for an unreachable server, a 5xx, a refused key or an error body", async () => {
    const { api } = scripted(
      new TypeError("fetch failed"),
      json(502, {}),
      json(401, {}),
      json(200, { error: true, message: "Error: boom" }),
      json(400, {}),
    );
    await expect(api.connect(NAME)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(api.connect(NAME)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(api.connect(NAME)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(api.connect(NAME)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(api.createInstance(NAME)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("never lets the reply's content into the error", async () => {
    const { api } = scripted(json(500, { ownerJid: "96512345678@s.whatsapp.net", base64: QR }));
    const error = (await api.connect(NAME).then(
      () => new Error("expected a refusal"),
      (e: unknown) => e,
    )) as Error & { cause?: unknown };
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).not.toContain("96512345678");
    expect(error.message).not.toContain(QR);
    expect(error.cause).toBeUndefined();
  });
});
