import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import { metaCredentialsInvalid, metaPhoneLast4 } from "../domain/meta-verification.ts";
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
