import { z } from "zod";
import { clinicSettingsInputSchema, clinicSettingsSchema } from "./clinics.ts";
import { accountProfileInputSchema, accountProfileSchema } from "./users.ts";

// Phase B slice 11 (ADR-0020): the clinic's own settings and the signed-in member's profile. Strict on
// both sides, so a field the contract does not name can neither be written nor leak out.

/** `PUT /v1/clinic/settings` (story 55): names, default language, time zone. */
export const clinicSettingsRequestSchema = clinicSettingsInputSchema.strict();
export type ClinicSettingsRequest = z.infer<typeof clinicSettingsRequestSchema>;

/** `GET`/`PUT /v1/clinic/settings`: slug and specialty are shown, never changed here. */
export const clinicSettingsResponseSchema = clinicSettingsSchema.strict();
export type ClinicSettingsResponse = z.infer<typeof clinicSettingsResponseSchema>;

/** `PUT /v1/account` (story 64): the caller's own name and interface language. */
export const accountRequestSchema = accountProfileInputSchema.strict();
export type AccountRequest = z.infer<typeof accountRequestSchema>;

/** `GET`/`PUT /v1/account`. */
export const accountResponseSchema = accountProfileSchema.strict();
export type AccountResponse = z.infer<typeof accountResponseSchema>;
