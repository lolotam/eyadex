import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

import { ResendMailSender } from "../../invitation-mail/mail/resend-mail-sender.ts";
import { createSmtpTransport } from "../../invitation-mail/mail/smtp-mail-sender.ts";
import type { MailSender } from "../../invitation-mail/ports/mail-sender.ts";
import { isPublicAddress, SMTP_PORTS } from "../domain/public-address.ts";
import type {
  ClinicProviderCredentials,
  ClinicSender,
  ClinicSenderFactory,
} from "../ports/clinic-sender-factory.ts";
import { PinnedSmtpSender } from "./pinned-smtp-sender.ts";

// Every test message carries its own `from`; this is only what an adapter needs to construct.
const UNUSED_FROM = "unused@invalid";
// Part of the 5 s send budget: the provider row stays locked while this runs.
const LOOKUP_TIMEOUT_MS = 1_500;
// A handful is enough for redundant and dual-stack servers; the 5 s budget would not reach more.
const MAX_ADDRESSES = 4;

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
 * المرسلين الحقيقيين: Resend بمفتاح العيادة، أو SMTP على العناوين اللي اتفحصت بس. SMTP بيتصل بس
 * بعناوين عامة على منفذ SMTP معروف، وبنفس العناوين اللي اتفحصت (ضد DNS rebinding)، والشهادة بتتفحص على
 * اسم السيرفر. IPv4 الأول، لأن container من غير مسار IPv6 بيفشل في AAAA.
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
    const addresses = await this.#resolvePublic(credentials.host);
    if (addresses === null) return refused("smtp_dns");
    if (addresses === "blocked") return refused("smtp_blocked_address");
    const connect = (address: string) =>
      this.#createTransport({
        host: address,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        servername: credentials.host,
      });
    return {
      sender: new PinnedSmtpSender(addresses, connect, UNUSED_FROM),
      close: () => undefined,
    };
  }

  // Every answer must be public, so a name mixing public and private answers cannot pass; the sender is
  // then pinned to these addresses only.
  async #resolvePublic(host: string): Promise<string[] | "blocked" | null> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), LOOKUP_TIMEOUT_MS);
    });
    try {
      const answers = await Promise.race([this.#lookup(host), deadline]);
      if (answers === "timeout" || answers.length === 0) return null;
      if (!answers.every((answer) => isPublicAddress(answer.address))) return "blocked";
      const unique = [...new Set(answers.map((answer) => answer.address))];
      const v4 = unique.filter((address) => isIPv4(address));
      const v6 = unique.filter((address) => !isIPv4(address));
      return [...v4, ...v6].slice(0, MAX_ADDRESSES);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
