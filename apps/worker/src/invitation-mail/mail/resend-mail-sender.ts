import type { MailMessage, MailResult, MailSender } from "../ports/mail-sender.ts";

export interface ResendOptions {
  readonly apiKey: string;
  /** مثلاً `Eyadex Team <no-reply@eyadex.com>`. */
  readonly from: string;
  /** للاختبار ضد stub محلي؛ الافتراضي `https://api.resend.com`. */
  readonly baseUrl?: string;
  /**
   * الافتراضي 5000: صف الدعوة ممسوك أثناء الإرسال، وأي كتابة في الـ API بتستنى الصف لازم تخلص قبل
   * سقف الـ transaction بتاعها (10 ثواني).
   */
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

const ERROR_NAME = /^[a-z_]{1,64}$/;

// Only the HTTP status and Resend's own error name (`validation_error`, `rate_limit_exceeded`…) leave this
// file: the response body can echo the recipient, and `last_error` is stored.
async function errorCode(response: Response): Promise<string> {
  let name = "";
  try {
    const body = (await response.json()) as { name?: unknown };
    if (typeof body.name === "string" && ERROR_NAME.test(body.name)) name = `:${body.name}`;
  } catch {
    // Not JSON: the status alone is the code.
  }
  return `resend_${response.status}${name}`;
}

/** المزود الوحيد في 7b-1: `POST /emails` بـ fetch، من غير SDK. */
export class ResendMailSender implements MailSender {
  readonly #options: Required<Omit<ResendOptions, "fetch">> & { fetch: typeof fetch };

  constructor(options: ResendOptions) {
    this.#options = {
      baseUrl: "https://api.resend.com",
      timeoutMs: 5_000,
      ...options,
      fetch: options.fetch ?? globalThis.fetch,
    };
  }

  async send(message: MailMessage): Promise<MailResult> {
    const { apiKey, from, baseUrl, timeoutMs, fetch: send } = this.#options;
    let response: Response;
    try {
      response = await send(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Resend keeps the key 24 h: a crash between the send and the commit re-sends nothing.
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return { sent: false, error: timedOut ? "resend_timeout" : "resend_network" };
    }
    if (response.ok) {
      await response.body?.cancel();
      return { sent: true };
    }
    return { sent: false, error: await errorCode(response) };
  }
}
