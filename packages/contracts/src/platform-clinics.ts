import { z } from "zod";
import { idSchema } from "./common.ts";
import {
  clinicStatusSchema,
  effectiveClinicStatusSchema,
  moduleSchema,
  specialtySchema,
} from "./clinics.ts";

// Phase B slice 5 (ADR-0010): what the platform team changes about one clinic, and what it reads.
// None of these shapes has a patient field (PRD §4.5, PLAT-02); a test pins that.

/** `PUT /v1/platform/clinics/:id/features/:module` (stories 14–15). */
export const setFeatureRequestSchema = z.object({ enabled: z.boolean() }).strict();
export type SetFeatureRequest = z.infer<typeof setFeatureRequestSchema>;

/**
 * `PATCH /v1/platform/clinics/:id/subscription` (stories 9–12). The expiry is EITHER a duration from
 * today (on the server clock) OR an explicit instant, never both. A past instant is accepted: the
 * platform may end access on purpose.
 */
export const updateSubscriptionRequestSchema = z
  .object({
    status: clinicStatusSchema.optional(),
    durationDays: z.number().int().min(1).max(3650).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.durationDays !== undefined && value.expiresAt !== undefined) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "validation.oneExpiry" });
    }
    if (value.status === undefined && value.durationDays === undefined && !value.expiresAt) {
      ctx.addIssue({ code: "custom", path: [], message: "validation.required" });
    }
  });
export type UpdateSubscriptionRequest = z.infer<typeof updateSubscriptionRequestSchema>;

/**
 * `PATCH /v1/platform/clinics/:id/limits` (story 13). A limit below current usage is accepted: it
 * only blocks new creates; existing users and branches stay (PRD §4.9).
 */
export const updateLimitsRequestSchema = z
  .object({
    maxUsers: z.number().int().min(1).max(1000).optional(),
    maxBranches: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => v.maxUsers !== undefined || v.maxBranches !== undefined, {
    message: "validation.required",
  });
export type UpdateLimitsRequest = z.infer<typeof updateLimitsRequestSchema>;

const usageSchema = z
  .object({ used: z.number().int().nonnegative(), max: z.number().int().positive() })
  .strict();

/**
 * `GET /v1/platform/clinics/:id` (story 18), also the answer of every write above. `access` is
 * computed on the server clock; "expired" is never stored. `usage.users` counts active members plus
 * live pending invitations. Strict on purpose: no patient field can be added by accident.
 */
export const platformClinicDetailSchema = z
  .object({
    id: idSchema,
    slug: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
    specialty: specialtySchema,
    status: clinicStatusSchema,
    access: z.enum(["allowed", "suspended", "expired"]),
    expiresAt: z.string().datetime(),
    defaultLanguage: z.enum(["ar", "en"]),
    /** IANA zone the clinic's dates are shown and counted in. */
    timezone: z.string(),
    createdAt: z.string().datetime(),
    modules: z.object({ patients: z.boolean() }).strict(),
    usage: z.object({ users: usageSchema, branches: usageSchema }).strict(),
  })
  .strict();
export type PlatformClinicDetail = z.infer<typeof platformClinicDetailSchema>;

/** The `:module` path segment. */
export const featureModuleParamSchema = moduleSchema;

/**
 * `GET /v1/platform/clinics` (story 18 list, ADR-0016): newest first (`created_at desc, id desc`),
 * cursor pagination. `search` matches the Arabic or English name or the slug.
 */
export const platformClinicListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().trim().min(1).max(100).optional(),
    /** Effective status (ADR-0020): "expired" is computed on the server clock, never stored. */
    status: effectiveClinicStatusSchema.optional(),
    specialty: specialtySchema.optional(),
  })
  .strict();
export type PlatformClinicListQuery = z.infer<typeof platformClinicListQuerySchema>;

/** Every item is the detail shape: strict, so no patient field or count can slip in (PLAT-02). */
export const platformClinicListResponseSchema = z
  .object({
    items: z.array(platformClinicDetailSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type PlatformClinicListResponse = z.infer<typeof platformClinicListResponseSchema>;
