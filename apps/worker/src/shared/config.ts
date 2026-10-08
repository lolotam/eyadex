import { LOG_LEVELS } from "@eyadex/observability";
import { z } from "zod";

// An empty value (the `.env.example` default) counts as unset.
const optional = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"] as const;

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z
  .object({
    WORKER_HOST: z.string().min(1).default("0.0.0.0"),
    WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    // Validated here so an invalid value never reaches pino, whose error message would print it.
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    // ADR-0013: eyadex_app reads the invitation under its clinic; eyadex_dispatcher touches the outbox only.
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
    EXPIRY_SCAN_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
    // ADR-0014 (7c-2): opens clinic mail credentials, bound to the provider row id. Not OUTBOX_SEAL_KEY.
    MAIL_PROVIDER_SEAL_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "32 bytes, base64"),
    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM: z.string().min(3),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
    // ADR-0014: the platform SMTP fallback — all four or none.
    SMTP_HOST: optional(z.string().min(1)),
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65_535)),
    SMTP_USER: optional(z.string().min(1)),
    SMTP_PASSWORD: optional(z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    const missing = SMTP_KEYS.filter((key) => env[key] === undefined);
    if (missing.length === 0 || missing.length === SMTP_KEYS.length) return;
    for (const key of missing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "SMTP is all or none" });
    }
  })
  .transform(({ SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, ...rest }) => ({
    ...rest,
    SMTP:
      SMTP_HOST !== undefined &&
      SMTP_PORT !== undefined &&
      SMTP_USER !== undefined &&
      SMTP_PASSWORD !== undefined
        ? { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, password: SMTP_PASSWORD }
        : null,
  }));

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
    throw new Error(`Invalid worker configuration: ${keys.join(", ")} — see .env.example`);
  }
  return result.data;
}
