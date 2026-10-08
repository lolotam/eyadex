import { z } from "zod";
import { clinicSettingsInputSchema, specialtySchema } from "./clinics.ts";
import { languageSchema } from "./common.ts";
import { accountProfileInputSchema } from "./users.ts";

// Phase B slice 11 (ADR-0020): the clinic's own settings and the signed-in member's profile. Strict on
// both sides, so a field the contract does not name can neither be written nor leak out.

/** `PUT /v1/clinic/settings` (story 55): names, default language, time zone. */
export const clinicSettingsRequestSchema = clinicSettingsInputSchema.strict();
export type ClinicSettingsRequest = z.infer<typeof clinicSettingsRequestSchema>;

/**
 * `GET`/`PUT /v1/clinic/settings`: slug and specialty are shown, never changed here. The answer holds
 * what is stored, so it does not re-apply the form's bounds: a name onboarding accepted is shown.
 */
export const clinicSettingsResponseSchema = z
  .object({
    nameAr: z.string(),
    nameEn: z.string(),
    defaultLanguage: languageSchema,
    timezone: z.string(),
    slug: z.string(),
    specialty: specialtySchema,
  })
  .strict();
export type ClinicSettingsResponse = z.infer<typeof clinicSettingsResponseSchema>;

/** `PUT /v1/account` (story 64): the caller's own name and interface language. */
export const accountRequestSchema = accountProfileInputSchema.strict();
export type AccountRequest = z.infer<typeof accountRequestSchema>;

/** `GET`/`PUT /v1/account`: what is stored, without the form's bounds (an invited name may be longer). */
export const accountResponseSchema = z
  .object({
    fullName: z.string(),
    preferredLanguage: languageSchema,
    email: z.string(),
    roleNameAr: z.string(),
    roleNameEn: z.string(),
  })
  .strict();
export type AccountResponse = z.infer<typeof accountResponseSchema>;
