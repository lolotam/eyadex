import { describe, expect, it } from "vitest";
import { apiErrorEnvelopeSchema } from "@eyadex/contracts/common";
import { WHATSAPP_RISK_VERSION } from "@eyadex/contracts/whatsapp";
import { isWhatsappUnavailable } from "../../api-error";
import { CLINIC, clientWith, code, USER } from "./fetch-stub";

const persona = { kind: "custom", clinicId: CLINIC, memberId: USER } as const;
const accept = { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION } as const;

describe("WhatsApp HTTP refusals", () => {
  it("shows the signup outage copy from the API's 503 envelope", async () => {
    const h = clientWith(() => ({
      status: 503,
      body: { code: "unknown", details: { code: "unavailable" } },
    }));
    const error = await h.api.whatsapp
      .embeddedSignup(persona, {
        code: crypto.randomUUID(),
        wabaId: "300000000000003",
        phoneNumberId: "400000000000004",
      })
      .catch((e: unknown) => e);
    expect(isWhatsappUnavailable(error)).toBe(true);
  });
  it("recognises an unconfigured server through the shared error envelope", async () => {
    const body = apiErrorEnvelopeSchema.parse({
      code: "unknown",
      message_ar: "حدث خطأ ما",
      message_en: "Something went wrong",
      details: { code: "unavailable" },
    });
    const h = clientWith(() => ({ status: 503, body }));
    const error = await h.api.whatsapp.connect(persona, accept).catch((e) => e);
    expect(isWhatsappUnavailable(error)).toBe(true);
    expect(h.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/clinic/whatsapp/connect" });
  });

  it("keeps a temporary Evolution outage generic", async () => {
    const h = clientWith(() => ({ status: 503, body: { code: "unknown" } }));
    const error = await h.api.whatsapp.connect(persona, accept).catch((e) => e);
    expect(isWhatsappUnavailable(error)).toBe(false);
  });

  it.each([
    ["transport", "coexistence_linked"],
    ["transport", "evolution_linked"],
    ["accessToken", "required"],
  ])("flattens %s/%s into the mock's field refusal", async (path, refusal) => {
    const h = clientWith(() => ({
      status: 400,
      body: {
        code: "validation",
        details: [{ path: [path], code: refusal }],
      },
    }));
    expect(await code(h.api.whatsapp.connect(persona, accept))).toEqual({
      code: "validation",
      details: { [path]: refusal },
    });
  });
});
