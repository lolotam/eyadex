import { classifyMetaError, classifyMetaResponse } from "../domain/meta-failure.ts";
import type { MetaSender } from "../ports/meta-sender.ts";
import type { FilledTemplate, WhatsappResult } from "../ports/whatsapp-sender.ts";

export const META_TIMEOUT_MS = 15_000;

/** حد Meta Graph؛ fetch متحقن للاختبارات، ولا يُحتفظ بنص أخطاء المزود. */
export class MetaGraphSender implements MetaSender {
  constructor(private readonly options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {}

  async sendTemplate(
    credentials: { readonly phoneNumberId: string; readonly accessToken: string },
    number: string,
    template: FilledTemplate,
  ): Promise<WhatsappResult> {
    try {
      const response = await (this.options.fetch ?? fetch)(
        `https://graph.facebook.com/v22.0/${encodeURIComponent(credentials.phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: number,
            type: "template",
            template: {
              name: template.name,
              language: { code: template.language },
              components: [
                {
                  type: "body",
                  parameters: template.parameters.map((text) => ({ type: "text", text })),
                },
              ],
            },
          }),
          redirect: "error",
          signal: AbortSignal.timeout(this.options.timeoutMs ?? META_TIMEOUT_MS),
        },
      );
      let body: unknown = null;
      try {
        body = await response.json();
      } catch (error) {
        if (classifyMetaError(error) === "meta_timeout")
          return { sent: false, error: "meta_timeout" };
      }
      return classifyMetaResponse(response.status, body);
    } catch (error) {
      return { sent: false, error: classifyMetaError(error) };
    }
  }
}
