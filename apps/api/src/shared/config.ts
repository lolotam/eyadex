import { ConfigurationError } from "@eyadex/observability";
import { LOG_LEVELS } from "@eyadex/observability";
import { legacyCoercedNumber } from "@eyadex/contracts/number-compat";
import { legacyInteger } from "@eyadex/contracts/integer-compat";
import { z } from "zod";

// Read once at startup; a missing or malformed value stops the process instead of failing later.
// Number checks come from `@eyadex/contracts`, which the compiled runtime loads from dist.
const schema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: legacyCoercedNumber()
    .check(legacyInteger())
    .check(z.gte(1))
    .check(z.lte(65_535))
    .default(3001),
  // Validated here so an invalid value never reaches pino, whose error message would print it.
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  // Optional until the first module is mounted; the eyadex_app role (PRD §4.5), never the owner.
  DATABASE_URL: z.string().url().optional(),
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
    throw new ConfigurationError("API", keys);
  }
  return result.data;
}
