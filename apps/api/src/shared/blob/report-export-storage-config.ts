import { ConfigurationError } from "@eyadex/observability";
import { z } from "zod";
import type { S3BlobStoreOptions } from "./s3-blob-store.ts";

const schema = z.object({
  FINANCE_EXPORT_BLOB_S3_ENDPOINT: z
    .string()
    .url()
    .refine((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );
    }),
  FINANCE_EXPORT_BLOB_S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  FINANCE_EXPORT_BLOB_S3_ACCESS_KEY: z.string().min(1),
  FINANCE_EXPORT_BLOB_S3_SECRET_KEY: z.string().min(1),
  FINANCE_EXPORT_BLOB_S3_REGION: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("us-east-1"),
});

/** Export credentials are independent; medical attachment credentials cannot enable exports. */
export function exportS3OptionsFromEnv(env: NodeJS.ProcessEnv): S3BlobStoreOptions {
  const result = schema.safeParse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")),
  );
  if (!result.success)
    throw new ConfigurationError("API", [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ]);
  const config = result.data;
  return {
    endpoint: new URL(config.FINANCE_EXPORT_BLOB_S3_ENDPOINT),
    bucket: config.FINANCE_EXPORT_BLOB_S3_BUCKET,
    accessKey: config.FINANCE_EXPORT_BLOB_S3_ACCESS_KEY,
    secretKey: config.FINANCE_EXPORT_BLOB_S3_SECRET_KEY,
    region: config.FINANCE_EXPORT_BLOB_S3_REGION,
  };
}
