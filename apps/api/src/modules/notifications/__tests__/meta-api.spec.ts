import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import {
  metaAccessToken,
  metaCredentialsInvalid,
  metaPhoneLast4,
  metaTwoStepEnabled,
} from "../domain/meta-verification.ts";
import { HttpMetaApi } from "../persistence/http-meta-api.ts";

const credentials = {
  accessToken: randomBytes(24).toString("hex"),
  phoneNumberId: "10000",
  businessAccountId: "20000",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const scripted = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return responses.shift()!;
  }) as typeof fetch;
  return { api: new HttpMetaApi(fetchImpl), calls };
};

describe("Meta verification boundary", () => {
  it("GETs the number then subscribes the business account without register", async () => {
    const { api, calls } = scripted(
      json(200, { display_phone_number: "+000 0000 0001", verified_name: "Fixture" }),
      json(200, { success: true }),
    );
    expect(await api.verify(credentials)).toBe("0001");
    expect(calls.map(({ url, init }) => [url, init.method])).toEqual([
      ["https://graph.facebook.com/v22.0/10000?fields=display_phone_number,verified_name", "GET"],
      ["https://graph.facebook.com/v22.0/20000/subscribed_apps", "POST"],
    ]);
    for (const { init } of calls) {
      expect(init.headers).toEqual({ Authorization: `Bearer ${credentials.accessToken}` });
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it.each([400, 401, 403])("maps HTTP %s to a token field error", async (status) => {
    const { api } = scripted(
      json(status, { error: { code: 1, message: credentials.accessToken } }),
    );
    await expect(api.verify(credentials)).rejects.toMatchObject({
      code: "validation",
      details: [{ path: ["accessToken"], code: "meta_credentials_invalid" }],
    });
  });
  it("recognizes numeric 190 and never chains the provider message", async () => {
    const { api } = scripted(json(200, { error: { code: 190, message: credentials.accessToken } }));
    const error = await api.verify(credentials).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(JSON.stringify(error)).not.toContain(credentials.accessToken);
  });
  it("classifies invalid credentials and last four digits without keeping the number", () => {
    for (const status of [400, 401, 403, 190])
      expect(metaCredentialsInvalid(status, null)).toBe(true);
    expect(metaCredentialsInvalid(200, { error: { code: 190 } })).toBe(true);
    expect(metaCredentialsInvalid(503, {})).toBe(false);
    expect(metaPhoneLast4({ display_phone_number: "+000 0000 0001" })).toBe("0001");
    for (const body of [null, {}, { display_phone_number: 1234 }, { display_phone_number: "12" }])
      expect(metaPhoneLast4(body)).toBeNull();
  });
  it.each([json(503, {}), json(200, {}), json(200, { error: { code: 999 } })])(
    "unknown or unavailable responses are 503",
    async (response) => {
      await expect(scripted(response).api.verify(credentials)).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    },
  );
  it("a subscription refusal fails verification", async () => {
    const { api } = scripted(json(200, { display_phone_number: "0001" }), json(403, {}));
    await expect(api.verify(credentials)).rejects.toMatchObject({ code: "validation" });
  });
  it("unreachable and timeout are 503 without causes", async () => {
    const unreachable = new HttpMetaApi((async () => {
      throw new TypeError(credentials.accessToken);
    }) as typeof fetch);
    await expect(unreachable.verify(credentials)).rejects.toBeInstanceOf(ServiceUnavailableError);
    const timed = new HttpMetaApi(
      ((_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        })) as typeof fetch,
      5,
    );
    await expect(timed.verify(credentials)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});

// N3 (spec §7.2): Embedded Signup's code exchange and the two-step refusal. Shaped placeholders only.
const app = { appId: "1234567890", appSecret: randomBytes(16).toString("hex") };
const code = randomBytes(12).toString("hex");

describe("Meta code exchange (Embedded Signup)", () => {
  it("GETs oauth/access_token with the app and the code, no redirect_uri and no bearer", async () => {
    const token = randomBytes(24).toString("hex");
    const { api, calls } = scripted(json(200, { access_token: token, token_type: "bearer" }));
    expect(await api.exchangeCode(code, app)).toBe(token);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v22.0/oauth/access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: app.appId,
      client_secret: app.appSecret,
      code,
    });
    expect(calls[0]!.init).toMatchObject({ method: "GET", redirect: "error", headers: {} });
  });
  it.each([400, 401, 403])("a refused code (HTTP %s) is a code field error", async (status) => {
    const { api } = scripted(json(status, { error: { code: 100, message: app.appSecret } }));
    const error = await api.exchangeCode(code, app).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "validation",
      details: [{ path: ["code"], code: "meta_code_invalid" }],
    });
    expect(JSON.stringify(error)).not.toContain(app.appSecret);
  });
  it.each([json(503, {}), json(200, {}), json(200, { access_token: "" })])(
    "an unavailable or malformed answer is 503",
    async (response) => {
      await expect(scripted(response).api.exchangeCode(code, app)).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    },
  );
  it("a network failure quoting the URL leaves as a bare 503", async () => {
    const api = new HttpMetaApi((async (url) => {
      throw new TypeError(`fetch failed ${String(url)}`);
    }) as typeof fetch);
    const error = await api.exchangeCode(code, app).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(app.appSecret);
    expect(String((error as Error).message)).not.toContain(app.appSecret);
  });
  it("two-step verification (2388001) wins over the 400 credentials refusal", async () => {
    const { api } = scripted(json(400, { error: { code: 2388001, message: "fixture" } }));
    await expect(api.verify(credentials)).rejects.toMatchObject({
      code: "validation",
      details: [{ path: ["phoneNumberId"], code: "meta_two_step_enabled" }],
    });
    expect(metaTwoStepEnabled({ error: { code: 2388001 } })).toBe(true);
    for (const body of [null, {}, { error: { code: "2388001" } }, { error: { code: 190 } }])
      expect(metaTwoStepEnabled(body)).toBe(false);
  });
  it("reads only a bounded string token", () => {
    expect(metaAccessToken({ access_token: "abc" })).toBe("abc");
    for (const body of [null, {}, { access_token: 1 }, { access_token: "x".repeat(4097) }])
      expect(metaAccessToken(body)).toBeNull();
  });
});
