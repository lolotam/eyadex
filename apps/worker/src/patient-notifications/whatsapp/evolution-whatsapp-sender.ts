import { classifyEvolutionError, classifyEvolutionResponse } from "../domain/evolution-failure.ts";
import type { WhatsappResult, WhatsappSender } from "../ports/whatsapp-sender.ts";

/** مهلة طلب Evolution الواحد: الدفتر والمراجع ممسوكين جوه transaction العيادة (سقفها 10 ثواني). */
export const EVOLUTION_TIMEOUT_MS = 8_000;

/** إعدادات Evolution (`EVOLUTION_API_URL` من غير `/` في الآخر، و`EVOLUTION_API_KEY`). */
export interface EvolutionOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** للاختبارات؛ الافتراضي `fetch` بتاع Node. */
  readonly fetch?: typeof fetch;
}

/**
 * Evolution API v2.3.7 (`POST /message/sendText/:instance`، هيدر
 * `apikey`). مفيش سطر هنا خالص: الرقم والنص وجسم الرد ماتطلعش من الدالة غير ككود قصير.
 */
export class EvolutionWhatsappSender implements WhatsappSender {
  readonly #options: EvolutionOptions;

  constructor(options: EvolutionOptions) {
    this.#options = options;
  }

  sendText(instance: string, number: string, text: string): Promise<WhatsappResult> {
    return this.#post("sendText", instance, { number, text });
  }

  async #post(
    action: "sendText",
    instance: string,
    body: Record<string, unknown>,
  ): Promise<WhatsappResult> {
    const send = this.#options.fetch ?? fetch;
    let response: Response;
    try {
      response = await send(
        `${this.#options.url}/message/${action}/${encodeURIComponent(instance)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", apikey: this.#options.apiKey },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? EVOLUTION_TIMEOUT_MS),
        },
      );
    } catch (error) {
      return { sent: false, error: classifyEvolutionError(error) };
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch (error) {
      // The deadline ran out while the body was read: the message may have gone out, like a timeout.
      if (classifyEvolutionError(error) === "evo_timeout")
        return { sent: false, error: "evo_timeout" };
      // A body that is not JSON is classified on the status alone.
    }
    return classifyEvolutionResponse(response.status, parsed);
  }
}
