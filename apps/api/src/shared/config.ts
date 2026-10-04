import { LOG_LEVELS } from "@eyadex/observability";
import { z } from "zod";

// TODO(spec) — packages/contracts is still TypeScript source imported by bundler, and Node refuses to load
// a .ts file out of node_modules, so the API cannot import it at runtime yet: everything here is read from
// the environment, and the bilingual table next door is tied to the contract's ApiErrorCode union at
// compile time instead. Both notes disappear when packages/contracts ships compiled output (and when the
// API moves to zod 4 with it — contracts stays on zod 3 until then).

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  // Validated here so an invalid value never reaches pino, whose error message would print it.
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export type ApiConfig = z.output<typeof schema>;

/**
 * Parses the API's environment. The error names the offending keys and never echoes a value.
 *
 * @param env the process environment
 * @returns the validated configuration
 */
export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid API configuration: ${keys.join(", ")} — see .env.example`);
  }
  return result.data;
}
