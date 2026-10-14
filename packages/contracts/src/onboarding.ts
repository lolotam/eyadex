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
  "staging-app",
  "staging-platform",
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
 * The modules a clinic can have switched on (PRD §4.8). A new module joins this list only: every
 * module map (a clinic's features, a new clinic's modules, the platform's default) follows it.
 */
export const CLINIC_MODULES = ["patients", "appointments", "medical", "finance"] as const;
export type ClinicModuleKey = (typeof CLINIC_MODULES)[number];

/** One on/off flag per module, keyed by the module. */
export const moduleFlagsSchema = z.object(
  Object.fromEntries(CLINIC_MODULES.map((m) => [m, z.boolean()])) as Record<
    ClinicModuleKey,
    z.ZodBoolean
  >,
);

/**
 * Modules that only work on top of another one (owner decision P2-14): a medical file lives inside a
 * patient file, so `medical` needs `patients`. The create form, the platform default and the
 * per-clinic switch all read this one table. An invoice names a patient, so `finance` needs `patients`
 * too (finance spec §2).
 */
export const MODULE_REQUIRES: Readonly<Partial<Record<ClinicModuleKey, ClinicModuleKey>>> = {
  medical: "patients",
  finance: "patients",
};

/** The first module switched on while the module it needs is off, or `null` when the map holds. */
export function moduleDependencyGap(
  flags: Readonly<Record<ClinicModuleKey, boolean>>,
): { module: ClinicModuleKey; requires: ClinicModuleKey } | null {
  for (const module of CLINIC_MODULES) {
    const requires = MODULE_REQUIRES[module];
    if (requires !== undefined && flags[module] && !flags[requires]) return { module, requires };
  }
  return null;
}

/** Zod refinement for a module map: the gap is reported on the module that cannot stand alone. */
export function refineModuleDependencies(
  flags: Readonly<Record<ClinicModuleKey, boolean>>,
  ctx: z.RefinementCtx,
): void {
  const gap = moduleDependencyGap(flags);
  if (gap !== null) {
    ctx.addIssue({ code: "custom", path: [gap.module], message: "validation.moduleRequires" });
  }
}

/**
 * A clinic's user and branch limits: the same bounds when it is created, when the platform changes
 * them, and as the platform's default for new clinics (ADR-0020 amendment, 2026-10-09).
 */
export const CLINIC_LIMIT_BOUNDS = {
  maxUsers: { min: 1, max: 1000 },
  maxBranches: { min: 1, max: 100 },
} as const;

/**
 * `POST /v1/platform/clinics` (PRD stories 6–7). Status, limits and modules are required inputs: the
 * create form pre-fills limits and modules from the platform settings and sends what the super admin
 * kept or changed, so the server never picks them (ADR-0020 amendment). The reserved-slug rule is NOT
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
    /**
     * EITHER an explicit instant OR `trialDays`, never both (ADR-0016). Neither = the platform's
     * default trial days, read by the server when it creates the clinic (ADR-0020).
     */
    expiresAt: z.string().datetime({ offset: true }).optional(),
    /** Days after the clinic's local today, ending 23:59:59 there; counted on the server clock. */
    trialDays: z.number().int().min(1).max(365).optional(),
    maxUsers: z
      .number()
      .int()
      .min(CLINIC_LIMIT_BOUNDS.maxUsers.min)
      .max(CLINIC_LIMIT_BOUNDS.maxUsers.max),
    maxBranches: z
      .number()
      .int()
      .min(CLINIC_LIMIT_BOUNDS.maxBranches.min)
      .max(CLINIC_LIMIT_BOUNDS.maxBranches.max),
    // One platform-wide default the form pre-fills (owner decision 2026-10-09), not PRD §4.8's
    // "by specialty" table: the value sent is always the super admin's.
    modules: moduleFlagsSchema.strict().superRefine(refineModuleDependencies),
    admin: z
      .object({
        fullName: name,
        email: z.string().trim().toLowerCase().email().max(254),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expiresAt !== undefined && value.trialDays !== undefined) {
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
