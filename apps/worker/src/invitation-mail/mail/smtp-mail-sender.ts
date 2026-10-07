import { createTransport } from "nodemailer";

import { displayName } from "../domain/mail-address.ts";
import type { MailMessage, MailResult, MailSender } from "../ports/mail-sender.ts";

/** The part of a nodemailer transporter this file uses: tests pass a jsonTransport/streamTransport. */
export interface SmtpTransport {
  sendMail(mail: {
    from: string | { name: string; address: string };
    replyTo?: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
  close(): void;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /**
   * The name the certificate must match when `host` is an address pinned after a DNS check (a clinic's
   * own SMTP, 7c-2a): TLS still verifies the server by its name.
   */
  readonly servername?: string;
}

// The invitation row is locked during the send (ADR-0013 §4): the whole send stays inside 5 s.
export const SMTP_BUDGET_MS = 5_000;

/**
 * One transporter for the process. Port 465 is implicit TLS; any other port must upgrade with
 * STARTTLS (`requireTLS`), so a server that cannot never receives plain text.
 */
export function createSmtpTransport(settings: SmtpSettings): SmtpTransport {
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
    ...(settings.servername === undefined ? {} : { tls: { servername: settings.servername } }),
    connectionTimeout: 2_000,
    greetingTimeout: 1_500,
    socketTimeout: 1_500,
    logger: false,
    debug: false,
  });
}

const CODE = /^E[A-Z]{2,20}$/;

// Only a short code leaves this file: the server's text can echo the address or the message.
export function smtpErrorCode(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; cause?: { code?: unknown } };
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "EAUTH") return "smtp_auth";
  if (code === "ETIMEDOUT") return "smtp_timeout";
  const cause = typeof e.cause?.code === "string" ? e.cause.code : "";
  if (code === "ECONNREFUSED" || cause === "ECONNREFUSED") return "smtp_econnrefused";
  if (typeof e.responseCode === "number" && Number.isInteger(e.responseCode)) {
    if (e.responseCode >= 200 && e.responseCode <= 599) return `smtp_${e.responseCode}`;
  }
  if (CODE.test(code)) return `smtp_${code.toLowerCase()}`;
  return "smtp_error";
}

/** SMTP المنصة: البديل لما Resend أكيد ما استلمش (ADR-0014). ما بيرميش أبداً. */
export class SmtpMailSender implements MailSender {
  constructor(
    private readonly transport: SmtpTransport,
    private readonly from: string,
    private readonly budgetMs = SMTP_BUDGET_MS,
  ) {}

  async send(message: MailMessage): Promise<MailResult> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.budgetMs);
    });
    try {
      const outcome = await Promise.race([
        this.transport.sendMail({
          from:
            message.from === undefined
              ? this.from
              : { name: displayName(message.from.name), address: message.from.address },
          ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        deadline,
      ]);
      if (outcome === "timeout") return { sent: false, error: "smtp_timeout" };
      return { sent: true, provider: "smtp", fallback: false };
    } catch (error) {
      return { sent: false, error: smtpErrorCode(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.transport.close();
  }
}
