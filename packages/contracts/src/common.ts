import { z } from "zod";

export const idSchema = z.string().uuid();

export const languageSchema = z.enum(["ar", "en"]);
export type Language = z.infer<typeof languageSchema>;

export const pageQuerySchema = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(100),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
};

export const apiErrorCodeSchema = z.enum([
  "not_found",
  "idempotency_conflict",
  "slug_taken",
  "reserved_slug",
  "limit_below_usage",
  "limit_reached",
  "last_active_branch",
  "branch_has_exclusive_members",
  "forbidden",
  "module_disabled",
  "validation",
  "email_taken",
  "last_active_admin",
  "account_disabled",
  "subscription_blocked",
  "role_inactive",
  "branch_inactive",
  "invitation_expired",
  "invitation_cancelled",
  "invitation_used",
  "role_locked",
  "role_in_use",
  "role_name_taken",
  "patient_phone_taken",
  "patient_civil_id_taken",
  "last_active_platform_account",
  "unauthorized",
  "two_factor_required",
  "two_factor_busy",
  "invalid_credentials",
  "rate_limited",
  "invitation_invalid",
  "account_other_area",
  "service_name_taken",
  "schedule_overlap",
  "provider_not_bookable",
  "provider_not_in_branch",
  "outside_schedule",
  "provider_time_off",
  "appointment_overlap",
  "patient_inactive",
  "service_inactive",
  "invalid_transition",
  "appointment_not_arrived",
  "visit_exists",
  "visit_signed",
  "visit_not_signed",
  "visit_not_provider",
  "visit_empty",
  "icd10_unknown",
  "medicine_name_taken",
  "attachment_too_large",
  "attachment_type",
  "attachment_patient_mismatch",
  "role_self_change",
  // Finance F1 (spec §3.3, R1-6/8/9/10/16, R2-5).
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
  "unknown",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * The codes a web screen can meet: every API code plus two the API never sends. `conflict` is a 409
 * whose code the web does not know; `not_implemented` is a method the HTTP adapter has no route for
 * yet. Kept apart from `apiErrorCodeSchema` because the API's message table must cover exactly the
 * codes the API can return.
 */
export const webErrorCodeSchema = z.enum([
  ...apiErrorCodeSchema.options,
  "conflict",
  "not_implemented",
]);
export type WebErrorCode = z.infer<typeof webErrorCodeSchema>;

/**
 * The envelope every error leaves the API as: a catalogued code plus both languages (CLAUDE.md §6).
 * `details` is optional and must never carry a secret, a civil ID or another clinic's data — it is
 * returned as-is.
 */
export const apiErrorEnvelopeSchema = z.object({
  code: apiErrorCodeSchema,
  message_ar: z.string().min(1),
  message_en: z.string().min(1),
  details: z.unknown().optional(),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

/**
 * Drops invisible format and control characters (ZWJ, ZWNJ, bidi marks and overrides, isolates,
 * soft hyphen, BOM, C0/C1 controls) and keeps ordinary whitespace. They render as nothing, so in a
 * name or a search term they can only hide or split what a reader sees: a civil ID or a phone split
 * by a ZWJ slips past digit-run checks, and a bidi override reorders the name on screen.
 */
export function stripInvisibleControls(text: string): string {
  return text.replace(/[\p{Cf}\p{Cc}]/gu, (c) => (/[\t\n\v\f\r]/.test(c) ? c : ""));
}
