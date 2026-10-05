import type { ApiErrorCode } from "@eyadex/contracts/common";

import { ApiError, codeForStatus } from "../../../shared/errors.ts";

// Better Auth codes that mean "the secret you typed is wrong": password, TOTP or backup code.
const CREDENTIAL_CODES = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "INVALID_CODE",
  "INVALID_BACKUP_CODE",
  "INVALID_TWO_FACTOR_COOKIE",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
]);

/**
 * بيحوّل رد Better Auth الفاشل لـ envelope الـ API (CLAUDE.md §6): العميل بيقرا كود من الكتالوج ورسالة
 * بلغتين، مش جسم Better Auth الخاص. كود Better Auth نفسه مابيطلعش للعميل.
 *
 * @param status الـ status اللي Better Auth رجّعه (4xx أو 5xx)
 * @param body جسم الرد كنص
 * @returns الخطأ المفهرس
 */
export function authFailure(status: number, body: string): ApiError {
  let providerCode: unknown;
  try {
    providerCode = (JSON.parse(body) as { code?: unknown } | null)?.code;
  } catch {
    providerCode = undefined;
  }
  if (typeof providerCode === "string" && CREDENTIAL_CODES.has(providerCode)) {
    return new ApiError("invalid_credentials");
  }
  const byStatus: Partial<Record<number, ApiErrorCode>> = {
    401: "unauthorized",
    403: "forbidden",
    429: "rate_limited",
  };
  return new ApiError(byStatus[status] ?? codeForStatus(status));
}
