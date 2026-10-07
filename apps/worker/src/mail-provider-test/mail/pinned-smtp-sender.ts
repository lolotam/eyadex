import {
  SMTP_BUDGET_MS,
  SmtpMailSender,
  type SmtpTransport,
} from "../../invitation-mail/mail/smtp-mail-sender.ts";
import type { MailMessage, MailResult, MailSender } from "../../invitation-mail/ports/mail-sender.ts";

// Failures where the next vetted address may still work: nothing reached a server that answered. An
// authentication or SMTP-reply error is the server itself, so another address would give the same.
const NEXT_ADDRESS = new Set([
  "smtp_econnrefused",
  "smtp_econnection",
  "smtp_econnreset",
  "smtp_ehostunreach",
  "smtp_enetunreach",
  "smtp_timeout",
]);
// Less than this left of the shared budget: another TCP and TLS handshake cannot finish.
const MIN_ATTEMPT_MS = 1_000;

/**
 * SMTP عيادة على العناوين اللي اتفحصت بس (ADR-0014): بيجرّب كل عنوان بالترتيب لو الاتصال نفسه فشل،
 * من غير أي DNS جديد، وكل المحاولات جوه نفس سقف الـ 5 ثواني. كل محاولة transporter جديد بيتقفل بعدها.
 */
export class PinnedSmtpSender implements MailSender {
  constructor(
    private readonly addresses: readonly string[],
    private readonly connect: (address: string) => SmtpTransport,
    private readonly from: string,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: MailMessage): Promise<MailResult> {
    const startedAt = this.now();
    let last: MailResult = { sent: false, error: "smtp_dns" };
    for (const address of this.addresses) {
      const left = SMTP_BUDGET_MS - (this.now() - startedAt);
      if (left < MIN_ATTEMPT_MS) break;
      const smtp = new SmtpMailSender(this.connect(address), this.from, left);
      try {
        last = await smtp.send(message);
      } finally {
        smtp.close();
      }
      if (last.sent || !NEXT_ADDRESS.has(last.error)) return last;
    }
    return last;
  }
}
