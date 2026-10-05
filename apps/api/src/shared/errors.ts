import type { ApiErrorCode, ApiErrorEnvelope } from "@eyadex/contracts/common";

import { API_ERROR_MESSAGES } from "./api-error-messages.ts";

// Every error the API returns and its HTTP status (CLAUDE.md §6). The messages, in both languages, live in
// api-error-messages.ts; a code with no status here answers 500, because the API is the only thing that
// could have produced it.
const STATUS: Partial<Record<ApiErrorCode, number>> = {
  validation: 400,
  reserved_slug: 400,
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  two_factor_required: 403,
  not_found: 404,
  // One answer for used, expired, cancelled and unknown tokens (ADR-0008): 404, not 410, because 410
  // would confirm the link once existed.
  invitation_invalid: 404,
  two_factor_busy: 409,
  idempotency_conflict: 409,
  slug_taken: 409,
  email_taken: 409,
  account_other_area: 409,
  rate_limited: 429,
  unknown: 500,
};

/**
 * An error that reaches the client as the bilingual envelope. `details` must never carry a secret, a civil
 * ID or another clinic's data — it is returned as-is.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, details?: unknown) {
    super(API_ERROR_MESSAGES[code].message_en);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code] ?? 500;
  }

  toEnvelope(): ApiErrorEnvelope {
    return {
      code: this.code,
      ...API_ERROR_MESSAGES[this.code],
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/**
 * Maps a framework HTTP status to a catalogued code. A catalogued status keeps its code; any other 4xx is a
 * malformed request, which the envelope reports as `validation`; any 5xx — or anything else — is `unknown`.
 * Codes for the statuses that have no business here yet (413, 415) arrive with the slice
 * that raises them.
 *
 * @param status the status the framework chose
 * @returns the catalogued code
 */
export function codeForStatus(status: number): ApiErrorCode {
  const found = (Object.keys(STATUS) as ApiErrorCode[]).find((code) => STATUS[code] === status);
  if (found !== undefined) return found;
  return status >= 400 && status < 500 ? "validation" : "unknown";
}
