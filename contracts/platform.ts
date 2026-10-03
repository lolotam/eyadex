import { z } from "zod";
import { idSchema } from "./common";
import { clinicStatusSchema } from "./clinics";

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
  emailSenderName: z.string().trim().min(2, "validation.tooShort").max(60, "validation.tooLong"),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  defaultTrialDays: 30,
  alertDaysBeforeExpiry: 14,
  emailSenderName: "Eyadex",
};

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

/** Status as read now: "expired" is computed from the expiry date, never stored. */
export const effectiveClinicStatusSchema = z.enum(["trial", "active", "suspended", "expired"]);
export type EffectiveClinicStatus = z.infer<typeof effectiveClinicStatusSchema>;

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

export function effectiveClinicStatus(
  clinic: { status: z.infer<typeof clinicStatusSchema>; expiresAt: string },
  now = Date.now(),
): EffectiveClinicStatus {
  if (clinic.status === "suspended") return "suspended";
  return new Date(clinic.expiresAt).getTime() < now ? "expired" : clinic.status;
}

/** Whole days left until the expiry instant, rounded up (0 = expires today). */
export function daysUntil(expiresAt: string, now = Date.now()): number {
  return Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS);
}

/**
 * Story 30: days left to show in the clinic banner, or null when no banner is due.
 * Expired clinics are blocked elsewhere, so they never get a banner.
 */
export function expiryAlertDays(expiresAt: string, alertDays: number, now = Date.now()): number | null {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms < 0) return null;
  const days = daysUntil(expiresAt, now);
  return days <= alertDays ? days : null;
}
