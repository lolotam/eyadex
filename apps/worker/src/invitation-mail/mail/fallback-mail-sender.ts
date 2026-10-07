import type { FallbackDecision } from "../domain/fallback-decision.ts";
import type { MailMessage, MailResult, MailSender } from "../ports/mail-sender.ts";

const MAX_ERROR = 120;

// One deadline for the whole chain: the invitation row is locked during the send, inside a tenant
// transaction capped at 10 s (@eyadex/db), and the read before and the commit after need headroom.
export const SEND_BUDGET_MS = 7_000;
// Less than this left after the primary: an SMTP handshake cannot finish, so retry later instead.
export const MIN_SECONDARY_MS = 1_000;

export interface FallbackOptions {
  readonly budgetMs?: number;
  readonly now?: () => number;
}

/** الأساسي أولاً؛ البديل بس لما `decide` يقول إن الأساسي أكيد ما استلمش (ADR-0014). */
export class FallbackMailSender implements MailSender {
  readonly #budgetMs: number;
  readonly #now: () => number;

  constructor(
    private readonly primary: MailSender,
    private readonly secondary: MailSender,
    private readonly decide: (primaryError: string) => FallbackDecision,
    options: FallbackOptions = {},
  ) {
    this.#budgetMs = options.budgetMs ?? SEND_BUDGET_MS;
    this.#now = options.now ?? Date.now;
  }

  async send(message: MailMessage): Promise<MailResult> {
    const startedAt = this.#now();
    const first = await this.primary.send(message);
    if (first.sent || this.decide(first.error) !== "try_secondary") return first;
    const left = this.#budgetMs - (this.#now() - startedAt);
    if (left < MIN_SECONDARY_MS) return failed(first.error, "fallback_no_time");
    const second = await this.#within(left, this.secondary.send(message));
    if (second.sent) return { sent: true, provider: second.provider, fallback: true };
    return failed(first.error, second.error);
  }

  async #within(ms: number, sending: Promise<MailResult>): Promise<MailResult> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<MailResult>((resolve) => {
      timer = setTimeout(() => resolve({ sent: false, error: "smtp_timeout" }), ms);
    });
    try {
      return await Promise.race([sending, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}

const failed = (primary: string, secondary: string): MailResult => ({
  sent: false,
  error: `${primary};${secondary}`.slice(0, MAX_ERROR),
});
