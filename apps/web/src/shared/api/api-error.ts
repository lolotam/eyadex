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

const F2_CODES: readonly string[] = FINANCE_F2_ERROR_CODES;
export type FinanceF2Code = (typeof FINANCE_F2_ERROR_CODES)[number];

/**
 * A finance F2 refusal. The web catalogue leaves these codes out (contracts `webErrorCodeSchema`), so the
 * HTTP adapter hands them on as `unknown` with the API's code in `details.code`; the mock does the same.
 */
export function financeError(code: FinanceF2Code): ApiError {
  return new ApiError("unknown", undefined, { code });
}

/** The i18n `errors.*` key of a failure: the F2 code inside `unknown`, else the catalogued code. */
export function errorKeyOf(error: unknown): string {
  if (error instanceof ApiError && error.code === "unknown") {
    const raw = error.details["code"];
    if (typeof raw === "string" && F2_CODES.includes(raw)) return raw;
  }
  return errorCodeOf(error);
}
