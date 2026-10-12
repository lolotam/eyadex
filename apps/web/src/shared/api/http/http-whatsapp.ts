import {
  whatsappChannelViewSchema,
  whatsappQrResponseSchema,
  type WhatsappCoexistenceRequest,
} from "@eyadex/contracts/whatsapp";
import type { WhatsappApi } from "../whatsapp-client";
import type { HttpContext } from "./http-context";

/** The request's declared fields only; the token is sent only when typed (write-only). */
export function toCoexistenceBody(input: WhatsappCoexistenceRequest): WhatsappCoexistenceRequest {
  return {
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
    phoneNumberId: input.phoneNumberId,
    businessAccountId: input.businessAccountId,
    templates: { ...input.templates },
  };
}

export function createHttpWhatsapp(ctx: HttpContext): WhatsappApi {
  const { transport } = ctx;
  return {
    channel: () =>
      transport.send("GET", "/v1/clinic/whatsapp", { schema: whatsappChannelViewSchema }),
    connect: (_persona, input) =>
      transport.send("POST", "/v1/clinic/whatsapp/connect", {
        schema: whatsappQrResponseSchema,
        body: { acceptRisk: input.acceptRisk, riskVersion: input.riskVersion },
      }),
    qr: () => transport.send("GET", "/v1/clinic/whatsapp/qr", { schema: whatsappQrResponseSchema }),
    disconnect: () => transport.sendEmpty("POST", "/v1/clinic/whatsapp/disconnect"),
    saveCoexistence: (_persona, input) =>
      transport.sendEmpty("PUT", "/v1/clinic/whatsapp/coexistence", {
        body: toCoexistenceBody(input),
      }),
  };
}
