import { z } from "zod";

// Self-contained on purpose (imports zod only): apps/api loads this file at runtime through Node's
// type stripping, which cannot follow the extensionless relative imports the other contract files use.

/** Slugs a clinic may never take: they are, or will be, Eyadex's own subdomains (PRD §4.15). */
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

/** The supported clinic time zones; any other value is rejected at the contract. */
export const timezoneOptions = [
  "Asia/Kuwait",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Africa/Cairo",
] as const;

const name = z.string().trim().min(2).max(120);

/**
 * `POST /v1/platform/clinics` (PRD stories 6–7). Every subscription value is a required input: the PRD
 * fixes no default status, expiry, limits or modules for a new clinic. The reserved-slug rule is NOT
 * here: the API answers it with its own code (`reserved_slug`), not a generic `validation`.
 */
export const createClinicRequestSchema = z
  .object({
    nameAr: name,
    nameEn: name,
    slug: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    specialty: z.enum(["psychiatry", "psychology", "dental", "dermatology", "obgyn", "general"]),
    defaultLanguage: z.enum(["ar", "en"]),
    timezone: z.enum(timezoneOptions),
    // TODO(spec): may a clinic be created already suspended? Not allowed until the PRD says so.
    status: z.enum(["trial", "active"]),
    /** EITHER an explicit instant OR `trialDays`, never both, never neither (ADR-0016). */
    expiresAt: z.string().datetime({ offset: true }).optional(),
    /** Days after the clinic's local today, ending 23:59:59 there; counted on the server clock. */
    trialDays: z.number().int().min(1).max(365).optional(),
    maxUsers: z.number().int().min(1).max(1000),
    maxBranches: z.number().int().min(1).max(100),
    // TODO(spec): PRD §4.8 opens default modules "by specialty" without a table, so it is an input.
    modules: z.object({ patients: z.boolean() }).strict(),
    admin: z
      .object({
        fullName: name,
        email: z.string().trim().toLowerCase().email().max(254),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.expiresAt === undefined) === (value.trialDays === undefined)) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "validation.oneExpiry" });
    }
  });
export type CreateClinicRequest = z.infer<typeof createClinicRequestSchema>;

/** The `Idempotency-Key` header: required on this route, printable ASCII, at most 200 characters. */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);

/** The answer — identifiers only. The invitation link is never returned: it is emailed (PRD story 7). */
export const createClinicResponseSchema = z.object({
  clinicId: z.string().uuid(),
  slug: z.string(),
  invitation: z.object({
    id: z.string().uuid(),
    email: z.string(),
    expiresAt: z.string().datetime(),
  }),
});
export type CreateClinicResponse = z.infer<typeof createClinicResponseSchema>;
