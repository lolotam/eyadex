import type { MailSender } from "../../invitation-mail/ports/mail-sender.ts";

/** بيانات اتصال مزود العيادة بعد فتح الختم. بتعيش في الذاكرة طول الإرسال بس. */
export type ClinicProviderCredentials =
  | { readonly kind: "resend"; readonly apiKey: string }
  | {
      readonly kind: "smtp";
      readonly host: string;
      readonly port: number;
      readonly user: string;
      readonly password: string;
    };

/** مرسل لتجربة واحدة، بيتقفل بعدها (transporter SMTP جديد كل مرة). */
export interface ClinicSender {
  readonly sender: MailSender;
  close(): void;
}

/** منفذ بناء مرسل العيادة (ADR-0014): من غير بديل المنصة، عشان التجربة تثبت مسار العيادة نفسه. */
export interface ClinicSenderFactory {
  /**
   * بيبني مرسل بنفس سقوف الـ 5 ثواني.
   *
   * @param credentials بيانات الاتصال
   * @returns المرسل ودالة القفل
   */
  open(credentials: ClinicProviderCredentials): ClinicSender;
}
