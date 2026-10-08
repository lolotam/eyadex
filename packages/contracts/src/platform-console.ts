import { z } from "zod";
import { effectiveClinicStatusSchema } from "./clinics.ts";
import { idSchema } from "./common.ts";
import {
  expiringClinicSchema,
  invitePlatformAccountInputSchema,
  platformAccountSchema,
  platformSettingsSchema,
} from "./platform.ts";

// Phase B slice 11 (ADR-0020): the platform console over HTTP. Every shape is strict: no clinic
// detail beyond names, statuses and dates, and no patient field or count can slip in (PLAT-02).

const count = z.number().int().nonnegative();

/** `GET /v1/platform/overview` (stories 3–4): counts by effective status, clinics expiring soon. */
export const platformOverviewResponseSchema = z
  .object({
    counts: z
      .object(
        Object.fromEntries(effectiveClinicStatusSchema.options.map((s) => [s, count])) as Record<
          z.infer<typeof effectiveClinicStatusSchema>,
          typeof count
        >,
      )
      .strict(),
    alertDaysBeforeExpiry: z.number().int().positive(),
    expiringSoon: z.array(expiringClinicSchema.strict()),
  })
  .strict();
export type PlatformOverviewResponse = z.infer<typeof platformOverviewResponseSchema>;

/** `GET`/`PUT /v1/platform/settings` (story 26). */
export const platformSettingsRequestSchema = platformSettingsSchema.strict();
export const platformSettingsResponseSchema = platformSettingsSchema.strict();
export type PlatformSettingsBody = z.infer<typeof platformSettingsRequestSchema>;

/** `GET /v1/platform/me`: the signed-in platform account. */
export const platformMeResponseSchema = z
  .object({ id: idSchema, fullName: z.string(), email: z.string() })
  .strict();
export type PlatformMeResponse = z.infer<typeof platformMeResponseSchema>;

/** `GET /v1/platform/team`: oldest first, opaque cursor. */
export const platformTeamListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type PlatformTeamListQuery = z.infer<typeof platformTeamListQuerySchema>;

export const platformAccountResponseSchema = platformAccountSchema.strict();
export type PlatformAccountResponse = z.infer<typeof platformAccountResponseSchema>;

export const platformTeamListResponseSchema = z
  .object({
    items: z.array(platformAccountResponseSchema),
    nextCursor: z.string().nullable(),
    total: count,
  })
  .strict();
export type PlatformTeamListResponse = z.infer<typeof platformTeamListResponseSchema>;

/** `POST /v1/platform/team` (story 24), with a required `Idempotency-Key`. */
export const invitePlatformAccountRequestSchema = invitePlatformAccountInputSchema.strict();
export type InvitePlatformAccountRequest = z.infer<typeof invitePlatformAccountRequestSchema>;

/**
 * `POST /v1/platform/invitations/inspect` — the token travels in the body (the request schema is
 * `inspectInvitationRequestSchema`). Answered only for a usable link.
 */
export const inspectPlatformInvitationResponseSchema = z
  .object({ fullName: z.string(), email: z.string(), expiresAt: z.string().datetime() })
  .strict();
export type InspectPlatformInvitationResponse = z.infer<
  typeof inspectPlatformInvitationResponseSchema
>;

/** `POST /v1/platform/invitations/accept`: no session is opened; the person signs in with TOTP. */
export const acceptPlatformInvitationResponseSchema = z.object({ email: z.string() }).strict();
export type AcceptPlatformInvitationResponse = z.infer<
  typeof acceptPlatformInvitationResponseSchema
>;
