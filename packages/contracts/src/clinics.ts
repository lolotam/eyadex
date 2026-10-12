import { z } from "zod";
import { idSchema, languageSchema, pageQuerySchema } from "./common.ts";
import {
  CLINIC_LIMIT_BOUNDS,
  CLINIC_MODULES,
  RESERVED_CLINIC_SLUGS,
  moduleFlagsSchema,
  refineModuleDependencies,
  timezoneOptions,
} from "./onboarding.ts";

export { CLINIC_LIMIT_BOUNDS, RESERVED_CLINIC_SLUGS, timezoneOptions };

const limitSchema = ({ min, max }: { min: number; max: number }) =>
  z
    .number({ invalid_type_error: "validation.number" })
    .int("validation.number")
    .min(min, "validation.min")
    .max(max, "validation.outOfRange");

/** A clinic's user limit as a form value: the API's bounds, with the form's messages. */
export const maxUsersSchema = limitSchema(CLINIC_LIMIT_BOUNDS.maxUsers);
/** A clinic's branch limit as a form value: the API's bounds, with the form's messages. */
export const maxBranchesSchema = limitSchema(CLINIC_LIMIT_BOUNDS.maxBranches);

export const clinicStatusSchema = z.enum(["trial", "active", "suspended"]);
export type ClinicStatus = z.infer<typeof clinicStatusSchema>;

/** Status as read now: "expired" is computed from the expiry date, never stored (SUB-02). */
export const effectiveClinicStatusSchema = z.enum(["trial", "active", "suspended", "expired"]);
export type EffectiveClinicStatus = z.infer<typeof effectiveClinicStatusSchema>;

/**
 * The stored status read at `now`: suspended wins; otherwise a clinic whose expiry is at or before
 * `now` is expired — the access guard's own boundary (access is allowed only while now < expiresAt).
 */
export function effectiveClinicStatus(
  clinic: { status: ClinicStatus; expiresAt: string },
  now = Date.now(),
): EffectiveClinicStatus {
  if (clinic.status === "suspended") return "suspended";
  return new Date(clinic.expiresAt).getTime() <= now ? "expired" : clinic.status;
}

export const specialtySchema = z.enum([
  "psychiatry",
  "psychology",
  "dental",
  "dermatology",
  "obgyn",
  "general",
]);
export type Specialty = z.infer<typeof specialtySchema>;

export const moduleSchema = z.enum(CLINIC_MODULES);
export type ClinicModule = z.infer<typeof moduleSchema>;

export const featuresSchema = moduleFlagsSchema;
export type ClinicFeatures = z.infer<typeof featuresSchema>;

/** A clinic with no flag rows: every module off (ADR-0010, default deny). */
export const NO_FEATURES: Readonly<ClinicFeatures> = Object.freeze(
  Object.fromEntries(CLINIC_MODULES.map((m) => [m, false])) as ClinicFeatures,
);

export const slugSchema = z
  .string()
  .trim()
  .min(3, "validation.tooShort")
  .max(40, "validation.tooLong")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "validation.slug")
  .refine(
    (slug) => !(RESERVED_CLINIC_SLUGS as readonly string[]).includes(slug),
    "validation.slugReserved",
  );

export const clinicSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  nameAr: z.string(),
  nameEn: z.string(),
  specialty: specialtySchema,
  defaultLanguage: languageSchema,
  timezone: z.string(),
  status: clinicStatusSchema,
  expiresAt: z.string().datetime(),
  maxUsers: z.number().int(),
  maxBranches: z.number().int(),
  createdAt: z.string().datetime(),
});
export type Clinic = z.infer<typeof clinicSchema>;

export const clinicUsageSchema = z.object({
  usersCount: z.number().int(),
  branchesCount: z.number().int(),
});

export const clinicListItemSchema = clinicSchema.merge(clinicUsageSchema);
export type ClinicListItem = z.infer<typeof clinicListItemSchema>;

export const clinicDetailSchema = clinicListItemSchema.extend({
  features: featuresSchema,
});
export type ClinicDetail = z.infer<typeof clinicDetailSchema>;

export const clinicListQuerySchema = pageQuerySchema.extend({
  search: z.string(),
  /** The effective status: "trial" and "active" leave out clinics whose expiry has passed. */
  status: effectiveClinicStatusSchema.nullable(),
  specialty: specialtySchema.nullable(),
});
export type ClinicListQuery = z.infer<typeof clinicListQuerySchema>;

export const clinicDetailsInputSchema = z.object({
  nameAr: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  nameEn: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  specialty: specialtySchema,
  defaultLanguage: languageSchema,
  timezone: z
    .string()
    .min(1, "validation.required")
    .refine((v) => (timezoneOptions as readonly string[]).includes(v), "validation.timezone"),
});
export type ClinicDetailsInput = z.infer<typeof clinicDetailsInputSchema>;

export const createClinicInputSchema = clinicDetailsInputSchema.extend({
  slug: slugSchema,
  adminName: z.string().trim().min(2, "validation.tooShort").max(120, "validation.tooLong"),
  adminEmail: z.string().trim().toLowerCase().email("validation.email"),
  // Pre-filled from the platform settings; whatever the super admin leaves here is what is sent.
  maxUsers: maxUsersSchema,
  maxBranches: maxBranchesSchema,
  modules: featuresSchema.superRefine(refineModuleDependencies),
});
export type CreateClinicInput = z.infer<typeof createClinicInputSchema>;

export const subscriptionInputSchema = z
  .object({
    status: clinicStatusSchema,
    expiryMode: z.enum(["duration", "date"]),
    durationMonths: z
      .number({ invalid_type_error: "validation.number" })
      .int()
      .min(1, "validation.min")
      .max(60),
    expiresOn: z.string(),
    maxUsers: maxUsersSchema,
    maxBranches: maxBranchesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.expiryMode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value.expiresOn)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresOn"],
        message: "validation.dateRequired",
      });
    }
  });
export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;

/**
 * Platform-only: the simulated first-admin invitation link. In production it is emailed;
 * it is never written to any audit entry.
 */
export const firstAdminInviteLinkSchema = z.object({
  email: z.string(),
  /** null = the link was emailed and is never returned (the API; PRD story 7). */
  token: z.string().nullable(),
  expiresAt: z.string().datetime(),
});
export type FirstAdminInviteLink = z.infer<typeof firstAdminInviteLinkSchema>;

export const createdClinicSchema = z.object({
  clinic: clinicSchema,
  firstAdminInvite: firstAdminInviteLinkSchema,
});
export type CreatedClinic = z.infer<typeof createdClinicSchema>;

/** The first-admin invitation while no clinic admin has accepted yet (story 19). */
export const firstAdminInviteStatusSchema = z.object({
  email: z.string(),
  fullName: z.string(),
  status: z.enum(["pending", "expired", "cancelled"]),
  expiresAt: z.string().datetime(),
});
export type FirstAdminInviteStatus = z.infer<typeof firstAdminInviteStatusSchema>;

/** Story 55: what a clinic admin may change about their own clinic. */
export const clinicSettingsInputSchema = clinicDetailsInputSchema.pick({
  nameAr: true,
  nameEn: true,
  defaultLanguage: true,
  timezone: true,
});
export type ClinicSettingsInput = z.infer<typeof clinicSettingsInputSchema>;

export const clinicSettingsSchema = clinicSettingsInputSchema.extend({
  slug: z.string(),
  specialty: specialtySchema,
});
export type ClinicSettings = z.infer<typeof clinicSettingsSchema>;
