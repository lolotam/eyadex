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
  account_disabled: 401,
  forbidden: 403,
  two_factor_required: 403,
  subscription_blocked: 403,
  module_disabled: 403,
  not_found: 404,
  // One answer for used, expired, cancelled and unknown tokens (ADR-0008): 404, not 410, because 410
  // would confirm the link once existed.
  invitation_invalid: 404,
  two_factor_busy: 409,
  idempotency_conflict: 409,
  slug_taken: 409,
  email_taken: 409,
  account_other_area: 409,
  limit_reached: 409,
  last_active_branch: 409,
  branch_has_exclusive_members: 409,
  last_active_admin: 409,
  last_active_platform_account: 409,
  role_locked: 409,
  role_in_use: 409,
  role_name_taken: 409,
  role_hidden_keys_invalid: 409,
  invitation_used: 409,
  invitation_cancelled: 409,
  patient_phone_taken: 409,
  patient_civil_id_taken: 409,
  service_name_taken: 409,
  schedule_overlap: 409,
  provider_not_bookable: 400,
  provider_not_in_branch: 400,
  outside_schedule: 409,
  provider_time_off: 409,
  appointment_overlap: 409,
  invalid_transition: 409,
  // P2 (R1-11). Kept after the generic codes: codeForStatus answers a framework status with the first
  // code listed for it, so a framework 403 or 409 stays `forbidden` or `two_factor_busy`.
  appointment_not_arrived: 409,
  visit_exists: 409,
  visit_signed: 409,
  visit_not_signed: 409,
  visit_not_provider: 403,
  visit_empty: 422,
  icd10_unknown: 422,
  medicine_name_taken: 409,
  attachment_too_large: 413,
  attachment_type: 415,
  attachment_patient_mismatch: 422,
  role_self_change: 403,
  // Finance F1: raised by their use case only (RULE_ONLY), after the generic codes.
  price_missing: 422,
  invoice_prefix_missing: 409,
  invoice_prefix_locked: 409,
  invoice_prefix_taken: 409,
  invoice_already_exists: 409,
  invoice_void: 409,
  appointment_not_billable: 409,
  currency_locked: 409,
  currency_unsupported: 400,
  discount_exceeds_total: 422,
  discount_reason_required: 422,
  precondition_required: 428,
  version_conflict: 412,
  send_request_conflict: 400,
  // One answer for expired, revoked and unknown links (R1-16), like invitation_invalid (ADR-0008).
  invoice_link_expired: 404,
  payment_method_disabled: 409,
  payment_exceeds_balance: 409,
  invoice_settled: 409,
  credit_insufficient: 409,
  refund_exceeds_available: 409,
  payment_methods_empty: 400,
  cash_drawer_changed: 409,
  invoice_paid_changed: 409,
  cash_closing_exists: 409,
  closing_note_required: 400,
  cash_drawer_out_of_range: 409,
  patient_inactive: 400,
  service_inactive: 400,
  role_inactive: 400,
  branch_inactive: 400,
  rate_limited: 429,
  unknown: 500,
};

// Raised by their use case only, never derived from a framework status (see codeForStatus).
const RULE_ONLY: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "price_missing",
  "invoice_prefix_missing",
  "invoice_prefix_locked",
  "invoice_prefix_taken",
  "invoice_already_exists",
  "invoice_void",
  "appointment_not_billable",
  "currency_locked",
  "currency_unsupported",
  "discount_exceeds_total",
  "discount_reason_required",
  "precondition_required",
  "version_conflict",
  "send_request_conflict",
  "invoice_link_expired",
  "payment_method_disabled",
  "payment_exceeds_balance",
  "invoice_settled",
  "credit_insufficient",
  "refund_exceeds_available",
  "payment_methods_empty",
  "cash_drawer_changed",
  "invoice_paid_changed",
  "cash_closing_exists",
  "closing_note_required",
  "cash_drawer_out_of_range",
  "visit_empty",
  "icd10_unknown",
  "attachment_too_large",
  "attachment_type",
  "attachment_patient_mismatch",
]);

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
 * The medical codes at 413, 415 and 422 name one business rule each (an attachment, a visit, an ICD-10
 * code): a framework 413 on any other route is not about an attachment, so they never answer a status.
 *
 * @param status the status the framework chose
 * @returns the catalogued code
 */
export function codeForStatus(status: number): ApiErrorCode {
  const found = (Object.keys(STATUS) as ApiErrorCode[]).find(
    (code) => STATUS[code] === status && !RULE_ONLY.has(code),
  );
  if (found !== undefined) return found;
  return status >= 400 && status < 500 ? "validation" : "unknown";
}

/** A dependency the request must not pass without (the rate limiter's Redis) is down: 503, `unknown`. */
export class ServiceUnavailableError extends ApiError {
  constructor(details?: unknown) {
    super("unknown", details);
  }

  override get status(): number {
    return 503;
  }
}
