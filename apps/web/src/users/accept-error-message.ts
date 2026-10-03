import { errorCodeOf } from "@/shared/api/api-error";
import type { TranslationKey } from "@/shared/i18n/dictionary";

type T = (key: TranslationKey) => string;

const ACCEPT_MESSAGES: Partial<Record<string, TranslationKey>> = {
  role_inactive: "invite.roleUnavailable",
  branch_inactive: "invite.branchUnavailable",
  email_taken: "invite.emailUnavailable",
  subscription_blocked: "invite.clinicUnavailable",
  invitation_expired: "invite.expiredBody",
  invitation_cancelled: "invite.cancelledBody",
  invitation_used: "invite.usedBody",
};

/** Explains why an invitation could not be accepted and what to do next. */
export function acceptErrorMessage(t: T, error: unknown): string {
  const code = errorCodeOf(error);
  return t(ACCEPT_MESSAGES[code] ?? (`errors.${code}` as TranslationKey));
}
