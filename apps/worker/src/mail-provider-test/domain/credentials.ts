import type { ClinicProviderCredentials } from "../ports/clinic-sender-factory.ts";

/** حقول الصف اللي بيانات الاتصال بتتبني منها. */
export interface ProviderConnection {
  readonly kind: "resend" | "smtp";
  readonly smtpHost: string | null;
  readonly smtpPort: number | null;
  readonly smtpUser: string | null;
}

/**
 * بيبني بيانات اتصال مزود العيادة من الصف والسر بعد فتح الختم.
 *
 * @param provider نوع المزود وحقول SMTP
 * @param secret مفتاح Resend أو باسورد SMTP
 * @returns البيانات، أو `null` لو صف SMTP ناقص
 */
export function credentialsOf(
  provider: ProviderConnection,
  secret: string,
): ClinicProviderCredentials | null {
  if (provider.kind === "resend") return { kind: "resend", apiKey: secret };
  if (provider.smtpHost === null || provider.smtpPort === null || provider.smtpUser === null) {
    return null;
  }
  return {
    kind: "smtp",
    host: provider.smtpHost,
    port: provider.smtpPort,
    user: provider.smtpUser,
    password: secret,
  };
}
