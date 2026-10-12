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
  /**
   * Whether the send in flight (or the last one) had already written the DATA command. A failure after it
   * is ambiguous: the server may have taken the message. Absent on a transport that cannot tell.
   */
  dataSent?(): boolean;
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
 * Watches nodemailer's transaction log for the client's DATA command and drops every line: server lines
 * can echo the recipient, so nothing here is ever forwarded. Only command lines are seen —
 * `transactionLog`, unlike `debug`, never pipes the message body to the logger.
 */
export function dataStageTracker(): {
  readonly logger: Record<"trace" | "debug" | "info" | "warn" | "error" | "fatal", LogLine>;
  readonly dataSent: () => boolean;
  readonly reset: () => void;
} {
  let sent = false;
  const ignore: LogLine = () => undefined;
  return {
    logger: {
      trace: ignore,
      debug: (entry, message) => {
        if (entry?.tnx === "client" && message === "DATA") sent = true;
      },
      info: ignore,
      warn: ignore,
      error: ignore,
      fatal: ignore,
    },
    dataSent: () => sent,
    reset: () => {
      sent = false;
    },
  };
}

type LogLine = (entry: { tnx?: unknown } | undefined, message?: unknown) => void;

/**
 * One transporter for the process. Port 465 is implicit TLS; any other port must upgrade with
 * STARTTLS (`requireTLS`), so a server that cannot never receives plain text. The worker sends one
 * message at a time (one poller), so one stage flag per transporter is enough.
 */
export function createSmtpTransport(settings: SmtpSettings): SmtpTransport {
  const stage = dataStageTracker();
  const transporter = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
    ...(settings.servername === undefined ? {} : { tls: { servername: settings.servername } }),
    connectionTimeout: 2_000,
    greetingTimeout: 1_500,
    socketTimeout: 1_500,
    logger: stage.logger,
    transactionLog: true,
    debug: false,
  });
  return {
    sendMail: (mail) => {
      stage.reset();
      return transporter.sendMail(mail);
    },
    close: () => transporter.close(),
    dataSent: stage.dataSent,
  };
}

const CODE = /^E[A-Z]{2,20}$/;
const REPLY = /^smtp_\d{3}$/;

/**
 * A failure once DATA was written gets the `_after_data` suffix, unless it is the server's own reply: a
 * reply is a refusal, but a timeout or a dropped connection then may hide an accepted message.
 *
 * @param code the short code
 * @param dataSent whether DATA had been written
 * @returns the code, marked when it is ambiguous
 */
export function afterDataCode(code: string, dataSent: boolean): string {
  return dataSent && !REPLY.test(code) ? `${code}_after_data` : code;
}

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
      if (outcome === "timeout") return { sent: false, error: this.#code("smtp_timeout") };
      return { sent: true, provider: "smtp", fallback: false };
    } catch (error) {
      return { sent: false, error: this.#code(smtpErrorCode(error)) };
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.transport.close();
  }

  #code(code: string): string {
    return afterDataCode(code, this.transport.dataSent?.() ?? false);
  }
}
