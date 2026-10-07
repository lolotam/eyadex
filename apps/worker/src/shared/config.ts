import { LOG_LEVELS } from "@eyadex/observability";
import { z } from "zod";

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z.object({
  WORKER_HOST: z.string().min(1).default("0.0.0.0"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  // Validated here so an invalid value never reaches pino, whose error message would print it.
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  // ADR-0013: eyadex_app reads the invitation under its clinic; eyadex_dispatcher touches the outbox only.
  DATABASE_URL: z.string().url(),
  DISPATCHER_DATABASE_URL: z.string().url(),
  OUTBOX_SEAL_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "32 bytes, base64"),
  // The clinic area's origin: the link is `${APP_URL}/invite/<token>`.
  APP_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, "")),
  RESEND_API_KEY: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
});

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
