import { ApiError, errorCodeOf } from "@/shared/api/api-error";
import type { TranslationKey } from "@/shared/i18n/dictionary";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Translates a users/invitations API error; the limit error carries its usage numbers. */
export function userErrorMessage(t: T, error: unknown): string {
  if (error instanceof ApiError && error.code === "limit_reached") {
    return t("users.limitReached", {
      used: error.details["used"] ?? 0,
      limit: error.details["limit"] ?? 0,
    });
  }
  return t(`errors.${errorCodeOf(error)}`);
}
