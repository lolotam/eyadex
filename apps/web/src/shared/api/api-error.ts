import { FINANCE_F2_ERROR_CODES, type WebErrorCode } from "@eyadex/contracts/common";

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
  return (
    error instanceof ApiError && error.code === "unknown" && error.details["code"] === "unavailable"
  );
}

export function whatsappUnavailableError(): ApiError {
  return new ApiError("unknown", undefined, { code: "unavailable" });
}

/** The finance F2 refusal codes (spec §4.6); the web catalogue carries every one of them. */
export type FinanceF2Code = (typeof FINANCE_F2_ERROR_CODES)[number];

/**
 * A finance F2 refusal (spec §4.6). The web catalogue knows these codes and the web carries their
 * messages in `errors.*`, so the refusal is its own code — no `details.code` workaround.
 */
export function financeError(code: FinanceF2Code): ApiError {
  return new ApiError(code);
}

/** The i18n `errors.*` key of a failure: the catalogued code of the error. */
export function errorKeyOf(error: unknown): string {
  return errorCodeOf(error);
}
