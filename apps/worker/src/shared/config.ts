import { LOG_LEVELS } from "@eyadex/observability";
import { z } from "zod";

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z.object({
  WORKER_HOST: z.string().min(1).default("0.0.0.0"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  // Validated here so an invalid value never reaches pino, whose error message would print it.
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
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
