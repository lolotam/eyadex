import { lookup as dnsLookup } from "node:dns/promises";

import { ResendMailSender } from "../../invitation-mail/mail/resend-mail-sender.ts";
import {
  createSmtpTransport,
  SmtpMailSender,
} from "../../invitation-mail/mail/smtp-mail-sender.ts";
import type { MailSender } from "../../invitation-mail/ports/mail-sender.ts";
import { isPublicAddress, SMTP_PORTS } from "../domain/public-address.ts";
import type {
  ClinicProviderCredentials,
  ClinicSender,
  ClinicSenderFactory,
} from "../ports/clinic-sender-factory.ts";

// Every test message carries its own `from`; this is only what an adapter needs to construct.
const UNUSED_FROM = "unused@invalid";
// Part of the 5 s send budget: the provider row stays locked while this runs.
const LOOKUP_TIMEOUT_MS = 1_500;

type Lookup = (host: string) => Promise<readonly { address: string }[]>;

export interface ClinicSenderOptions {
  readonly lookup?: Lookup;
  readonly createTransport?: typeof createSmtpTransport;
}

const refused = (error: string): ClinicSender => {
  const sender: MailSender = { send: async () => ({ sent: false, error }) };
  return { sender, close: () => undefined };
};

const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * المرسلين الحقيقيين: Resend بمفتاح العيادة، أو SMTP بـ transporter جديد بيتقفل بعد الإرسال. SMTP
 * بيتصل بس بعنوان عام على منفذ SMTP معروف، وبنفس العنوان اللي اتفحص (ضد DNS rebinding)، والشهادة
 * بتتفحص على اسم السيرفر.
 */
export class RealClinicSenderFactory implements ClinicSenderFactory {
  readonly #lookup: Lookup;
  readonly #createTransport: typeof createSmtpTransport;

  constructor(options: ClinicSenderOptions = {}) {
    this.#lookup = options.lookup ?? systemLookup;
    this.#createTransport = options.createTransport ?? createSmtpTransport;
  }

  async open(credentials: ClinicProviderCredentials): Promise<ClinicSender> {
    if (credentials.kind === "resend") {
      return {
        sender: new ResendMailSender({ apiKey: credentials.apiKey, from: UNUSED_FROM }),
        close: () => undefined,
      };
    }
    if (!SMTP_PORTS.includes(credentials.port)) return refused("smtp_port_not_allowed");
    const address = await this.#resolvePublic(credentials.host);
    if (address === null) return refused("smtp_dns");
    if (address === "blocked") return refused("smtp_blocked_address");
    const transport = this.#createTransport({
      host: address,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      servername: credentials.host,
    });
    const smtp = new SmtpMailSender(transport, UNUSED_FROM);
    return { sender: smtp, close: () => smtp.close() };
  }

  // Every answer must be public, so a name mixing public and private answers cannot pass; the
  // transport is then pinned to the first address checked here.
  async #resolvePublic(host: string): Promise<string | "blocked" | null> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), LOOKUP_TIMEOUT_MS);
    });
    try {
      const answers = await Promise.race([this.#lookup(host), deadline]);
      if (answers === "timeout" || answers.length === 0) return null;
      if (!answers.every((answer) => isPublicAddress(answer.address))) return "blocked";
      return answers[0]!.address;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
