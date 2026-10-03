import { z } from "zod";
import { idSchema, languageSchema, pageQuerySchema } from "./common";

/** The supported clinic time zones; any other value is rejected at the contract. */
export const timezoneOptions = [
  "Asia/Kuwait",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Africa/Cairo",
] as const;

export const clinicStatusSchema = z.enum(["trial", "active", "suspended"]);
export type ClinicStatus = z.infer<typeof clinicStatusSchema>;

export const specialtySchema = z.enum([
  "psychiatry",
  "psychology",
  "dental",
  "dermatology",
  "obgyn",
  "general",
]);
export type Specialty = z.infer<typeof specialtySchema>;

export const moduleSchema = z.enum(["patients"]);
export type ClinicModule = z.infer<typeof moduleSchema>;

export const featuresSchema = z.object({ patients: z.boolean() });
export type ClinicFeatures = z.infer<typeof featuresSchema>;

export const RESERVED_CLINIC_SLUGS = [
  "app",
  "platform",
  "api",
  "www",
  "admin",
  "staging",
  "cdn",
  "mail",
  "status",
  "docs",
  "help",
  "support",
  "auth",
  "static",
  "assets",
] as const;

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
  status: clinicStatusSchema.nullable(),
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
    maxUsers: z
      .number({ invalid_type_error: "validation.number" })
      .int()
      .min(1, "validation.min")
      .max(1000),
    maxBranches: z
      .number({ invalid_type_error: "validation.number" })
      .int()
      .min(1, "validation.min")
      .max(100),
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
  token: z.string(),
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
