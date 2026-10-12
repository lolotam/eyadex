import type { WebErrorCode } from "@eyadex/contracts/common";

export class ApiError extends Error {
  readonly code: WebErrorCode;
  readonly details: Readonly<Record<string, string | number>>;

  constructor(
    code: WebErrorCode,
    message?: string,
    details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message ?? code);
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
}

export function errorCodeOf(error: unknown): WebErrorCode {
  return error instanceof ApiError ? error.code : "unknown";
}

/**
 * The server has no WhatsApp configured (spec §7.1: both Evolution settings unset). `unavailable` is
 * not in the web error catalogue, so it arrives as `unknown` with the raw code in `details.code`.
 */
export function isWhatsappUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === "unknown" && error.details.code === "unavailable";
}

export function whatsappUnavailableError(): ApiError {
  return new ApiError("unknown", undefined, { code: "unavailable" });
}
