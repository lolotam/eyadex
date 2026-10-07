import type { FallbackDecision } from "../domain/fallback-decision.ts";
import type { MailMessage, MailResult, MailSender } from "../ports/mail-sender.ts";

const MAX_ERROR = 120;

/** الأساسي أولاً؛ البديل بس لما `decide` يقول إن الأساسي أكيد ما استلمش (ADR-0014). */
export class FallbackMailSender implements MailSender {
  constructor(
    private readonly primary: MailSender,
    private readonly secondary: MailSender,
    private readonly decide: (primaryError: string) => FallbackDecision,
  ) {}

  async send(message: MailMessage): Promise<MailResult> {
    const first = await this.primary.send(message);
    if (first.sent || this.decide(first.error) !== "try_secondary") return first;
    const second = await this.secondary.send(message);
    if (second.sent) return { sent: true, provider: second.provider, fallback: true };
    return { sent: false, error: `${first.error};${second.error}`.slice(0, MAX_ERROR) };
  }
}
