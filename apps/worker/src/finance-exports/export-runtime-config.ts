import { ConfigurationError } from "@eyadex/observability";
import { z } from "zod";

const schema = z.object({
  MEDICAL_BLOB_S3_ENDPOINT: z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === ""
        );
      } catch {
        return false;
      }
    }),
  MEDICAL_BLOB_S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  MEDICAL_BLOB_S3_ACCESS_KEY: z.string().min(1),
  MEDICAL_BLOB_S3_SECRET_KEY: z.string().min(1),
  MEDICAL_BLOB_S3_REGION: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("us-east-1"),
  EXPORT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  EXPORT_SWEEP_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(60_000),
});

/** Nothing enabled implicitly; a partial export environment refuses to start the enabled runtime. */
export function readExportRuntimeConfig(env: NodeJS.ProcessEnv) {
  const enabled = env["FINANCE_EXPORTS_ENABLED"];
  if (enabled === undefined || enabled === "" || enabled === "false") return null;
  if (enabled !== "true") throw new ConfigurationError("worker", ["FINANCE_EXPORTS_ENABLED"]);
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")),
  );
  if (!parsed.success)
    throw new ConfigurationError("worker", [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  return parsed.data;
}
