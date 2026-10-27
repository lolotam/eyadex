import { ConfigurationError } from "@eyadex/observability";
import { LOG_LEVELS } from "@eyadex/observability";
import { fieldCipherFromEnv, type FieldCipher } from "@eyadex/secrets";
import { legacyCoercedNumber } from "@eyadex/contracts/number-compat";
import { legacyInteger } from "@eyadex/contracts/integer-compat";
import { z } from "zod";

// An empty value (the `.env.example` default) counts as unset.
const optional = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"] as const;
const EVOLUTION_KEYS = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY"] as const;

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z
  .object({
    WORKER_HOST: z.string().min(1).default("0.0.0.0"),
    WORKER_PORT: legacyCoercedNumber()
      .check(legacyInteger())
      .check(z.gte(1))
      .check(z.lte(65_535))
      .default(3002),
    // Validated here so an invalid value never reaches pino, whose error message would print it.
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    // ADR-0013: eyadex_app reads the invitation under its clinic; eyadex_dispatcher touches the outbox only
    // (and runs the retention purge functions, ADR-0022).
    DATABASE_URL: z.string().url(),
    DISPATCHER_DATABASE_URL: z.string().url(),
    // ADR-0020: the expiry scan (clinics + platform_settings) and the platform-team invitation check.
    PLATFORM_DATABASE_URL: z.string().url(),
    OUTBOX_SEAL_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "32 bytes, base64"),
    // The clinic area's origin: the link is `${APP_URL}/invite/<token>`.
    APP_URL: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, "")),
    // The platform area's origin: a platform-team link is `${PLATFORM_URL}/invite/<token>` (ADR-0020).
    PLATFORM_URL: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, "")),
    // How often the expiry reminder scan runs; the ledger makes a reminder once per expiry date anyway.
    EXPIRY_SCAN_INTERVAL_MS: legacyCoercedNumber()
      .check(legacyInteger())
      .check(z.gte(60_000))
      .check(z.lte(86_400_000))
      .default(3_600_000),
    // How often the appointment reminder scan runs (spec §3.2); the ledger makes a reminder once per start.
    REMINDER_SCAN_INTERVAL_MS: legacyCoercedNumber()
      .check(legacyInteger())
      .check(z.gte(60_000))
      .check(z.lte(86_400_000))
      .default(300_000),
    // How often the retention purge runs (ADR-0022); the database decides what is old enough to go.
    RETENTION_PURGE_INTERVAL_MS: legacyCoercedNumber()
      .check(legacyInteger())
      .check(z.gte(60_000))
      .check(z.lte(86_400_000))
      .default(3_600_000),
    // ADR-0014 (7c-2): opens clinic mail credentials, bound to the provider row id. Not OUTBOX_SEAL_KEY.
    MAIL_PROVIDER_SEAL_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "32 bytes, base64"),
    // Finance F1 (C1, spec §8c.1): seals the invoice link token for retries. Worker only; a different key from
    // every other. Unset = invoice messages wait (stay queued) and every other kind still sends.
    INVOICE_LINK_SEAL_KEY: optional(
      z.string().refine((v) => Buffer.from(v, "base64").length === 32, "32 bytes, base64"),
    ),
    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM: z.string().min(3),
    OUTBOX_POLL_INTERVAL_MS: legacyCoercedNumber()
      .check(legacyInteger())
      .check(z.gte(100))
      .check(z.lte(60_000))
      .default(2_000),
    // ADR-0014: the platform SMTP fallback — all four or none.
    SMTP_HOST: optional(z.string().min(1)),
    SMTP_PORT: optional(
      legacyCoercedNumber().check(legacyInteger()).check(z.gte(1)).check(z.lte(65_535)),
    ),
    SMTP_USER: optional(z.string().min(1)),
    SMTP_PASSWORD: optional(z.string().min(1)),
    // Spec §7.1 (N2): the internal Evolution API and its key — both or neither; neither = no WhatsApp.
    EVOLUTION_API_URL: optional(
      z
        .string()
        .url()
        .refine((v) => {
          try {
            const url = new URL(v);
            return (
              (url.protocol === "http:" || url.protocol === "https:") &&
              url.username === "" &&
              url.password === "" &&
              url.pathname === "/" &&
              url.search === "" &&
              url.hash === ""
            );
          } catch {
            return false;
          }
        }, "http or https origin")
        .transform((v) => v.replace(/\/+$/, "")),
    ),
    EVOLUTION_API_KEY: optional(z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    // ADR-0014 SMTP and §7.1 Evolution: each group is all or none; a partial group names its missing keys.
    const groups = [
      { keys: SMTP_KEYS, message: "SMTP is all or none" },
      { keys: EVOLUTION_KEYS, message: "Evolution is both or none" },
    ];
    for (const { keys, message } of groups) {
      const missing = keys.filter((key) => env[key] === undefined);
      if (missing.length === 0 || missing.length === keys.length) continue;
      for (const key of missing)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
    }
  })
  .transform(
    ({
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASSWORD,
      EVOLUTION_API_URL,
      EVOLUTION_API_KEY,
      ...rest
    }) => ({
      ...rest,
      SMTP:
        SMTP_HOST !== undefined &&
        SMTP_PORT !== undefined &&
        SMTP_USER !== undefined &&
        SMTP_PASSWORD !== undefined
          ? { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, password: SMTP_PASSWORD }
          : null,
      EVOLUTION:
        EVOLUTION_API_URL !== undefined && EVOLUTION_API_KEY !== undefined
          ? { url: EVOLUTION_API_URL, apiKey: EVOLUTION_API_KEY }
          : null,
    }),
  );

export type WorkerConfig = z.output<typeof schema>;

/**
 * Parses the worker's environment. The error names the offending keys and never echoes a value.
 *
 * @param env the process environment
 * @returns the validated configuration
 */
export function readConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new ConfigurationError("worker", keys);
  }
  return result.data;
}

const MEDICAL_KEY = /^MEDICAL_MASTER_KEY_V[1-9][0-9]{0,3}$/;

/**
 * The prescription email opens the visit's medicine lines (ADR-0028), so the worker reads the same
 * `MEDICAL_MASTER_KEY_V<n>` keys as the API. Optional like the SMTP fallback: with none set, a prescription
 * message fails with `no_medical_key` and every other message still goes out. A key that is set but
 * malformed stops the process (`KeyConfigError` names the variable, never the value).
 *
 * @param env the process environment
 * @returns the cipher, or `null` when no medical key is set
 */
export function medicalCipher(env: NodeJS.ProcessEnv): FieldCipher | null {
  const configured = Object.entries(env).some(([name, value]) => MEDICAL_KEY.test(name) && !!value);
  return configured ? fieldCipherFromEnv(env) : null;
}
