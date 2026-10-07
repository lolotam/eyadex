import { ResendMailSender } from "../../invitation-mail/mail/resend-mail-sender.ts";
import {
  createSmtpTransport,
  SmtpMailSender,
} from "../../invitation-mail/mail/smtp-mail-sender.ts";
import type {
  ClinicProviderCredentials,
  ClinicSender,
  ClinicSenderFactory,
} from "../ports/clinic-sender-factory.ts";

// Every test message carries its own `from`; this is only what an adapter needs to construct.
const UNUSED_FROM = "unused@invalid";

/** المرسلين الحقيقيين: Resend بمفتاح العيادة، أو SMTP بـ transporter جديد بيتقفل بعد الإرسال. */
export class RealClinicSenderFactory implements ClinicSenderFactory {
  open(credentials: ClinicProviderCredentials): ClinicSender {
    if (credentials.kind === "resend") {
      return {
        sender: new ResendMailSender({ apiKey: credentials.apiKey, from: UNUSED_FROM }),
        close: () => undefined,
      };
    }
    const smtp = new SmtpMailSender(createSmtpTransport(credentials), UNUSED_FROM);
    return { sender: smtp, close: () => smtp.close() };
  }
}
