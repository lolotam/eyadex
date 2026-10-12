import { z } from "zod";
import { idSchema } from "./common.ts";
import {
  CLINIC_LIMIT_BOUNDS,
  clinicStatusSchema,
  effectiveClinicStatus,
  effectiveClinicStatusSchema,
  featuresSchema,
  type ClinicFeatures,
  type EffectiveClinicStatus,
} from "./clinics.ts";
import { refineModuleDependencies } from "./onboarding.ts";

export { effectiveClinicStatus, effectiveClinicStatusSchema, type EffectiveClinicStatus };

const DAY_MS = 24 * 60 * 60 * 1000;

const intIn = (min: number, max: number) =>
  z
    .number({ invalid_type_error: "validation.number" })
    .int("validation.number")
    .min(min, "validation.outOfRange")
    .max(max, "validation.outOfRange");

/** Story 26: platform-wide defaults. Bounds are part of the contract, not the UI. */
export const platformSettingsSchema = z.object({
  defaultTrialDays: intIn(1, 90),
  alertDaysBeforeExpiry: intIn(1, 60),
  // It becomes an email display name: a line break or another control character could forge a header.
  emailSenderName: z
    .string()
    .trim()
    .min(2, "validation.tooShort")
    .max(60, "validation.tooLong")
    .regex(/^\P{Cc}*$/u, "validation.controlChars"),
  // What the create-clinic form starts from (owner decision 2026-10-09). The same bounds as a
  // clinic's own limits, so every default is a valid create. The modules are the clinic module map
  // itself, so a new module joins the setting when it joins the module list.
  defaultMaxUsers: intIn(CLINIC_LIMIT_BOUNDS.maxUsers.min, CLINIC_LIMIT_BOUNDS.maxUsers.max),
  defaultMaxBranches: intIn(
    CLINIC_LIMIT_BOUNDS.maxBranches.min,
    CLINIC_LIMIT_BOUNDS.maxBranches.max,
  ),
  // Stored defaults can predate a dependency; they must remain readable so staff can repair them.
  defaultModules: featuresSchema.strict(),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const updatePlatformSettingsSchema = platformSettingsSchema.extend({
  defaultModules: featuresSchema.strict().superRefine(refineModuleDependencies),
});

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  defaultTrialDays: 14,
  alertDaysBeforeExpiry: 7,
  emailSenderName: "Eyadex",
  defaultMaxUsers: 10,
  defaultMaxBranches: 3,
  // P2 R2-3: the medical module's release (0050) turned it on for new clinics.
  defaultModules: { patients: true, appointments: true, medical: true },
};

/**
 * The limits and modules a new clinic's form starts with: the platform defaults, which the super
 * admin may change for that clinic before creating it.
 */
export function newClinicDefaults(settings: PlatformSettings): {
  maxUsers: number;
  maxBranches: number;
  modules: ClinicFeatures;
} {
  return {
    maxUsers: settings.defaultMaxUsers,
    maxBranches: settings.defaultMaxBranches,
    modules: { ...settings.defaultModules },
  };
}

export const platformAccountStatusSchema = z.enum(["active", "invited", "deactivated"]);
export type PlatformAccountStatus = z.infer<typeof platformAccountStatusSchema>;

export const platformAccountSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  email: z.string().email(),
  status: platformAccountStatusSchema,
  /** Set once the account has signed in; reactivating returns it to active or invited. */
  joinedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PlatformAccount = z.infer<typeof platformAccountSchema>;

export const invitePlatformAccountInputSchema = z.object({
  fullName: z.string().trim().min(2, "validation.tooShort").max(100, "validation.tooLong"),
  email: z.string().trim().toLowerCase().email("validation.email").max(255, "validation.tooLong"),
});
export type InvitePlatformAccountInput = z.infer<typeof invitePlatformAccountInputSchema>;

export const expiringClinicSchema = z.object({
  id: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
  status: clinicStatusSchema,
  expiresAt: z.string().datetime(),
  daysLeft: z.number().int(),
});
export type ExpiringClinic = z.infer<typeof expiringClinicSchema>;

/** Stories 3–4. Clinic names and statuses only: no patient data or counts by construction. */
export const platformOverviewSchema = z.object({
  counts: z.record(effectiveClinicStatusSchema, z.number().int().nonnegative()),
  alertDaysBeforeExpiry: z.number().int(),
  expiringSoon: z.array(expiringClinicSchema),
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

/** Whole days left until the expiry instant, rounded up (0 = expires today). */
export function daysUntil(expiresAt: string, now = Date.now()): number {
  return Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS);
}

/**
 * Story 30: days left to show in the clinic banner, or null when no banner is due.
 * Expired clinics are blocked elsewhere, so they never get a banner.
 */
export function expiryAlertDays(
  expiresAt: string,
  alertDays: number,
  now = Date.now(),
): number | null {
  const ms = new Date(expiresAt).getTime() - now;
  // At the expiry instant access already ends (the guard's boundary), so no banner either.
  if (ms <= 0) return null;
  const days = daysUntil(expiresAt, now);
  return days <= alertDays ? days : null;
}
