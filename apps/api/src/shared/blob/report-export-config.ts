import { ConfigurationError } from "@eyadex/observability";
import { s3BlobOptionsFromEnv } from "./blob-store-config.ts";
import { S3ReportExportFiles } from "./s3-report-export-files.ts";

/** Rollout switch: API routes stay absent until storage policy and the worker are ready together. */
export function reportExportRuntimeFromEnv(env: NodeJS.ProcessEnv) {
  const enabled = env["FINANCE_EXPORTS_ENABLED"];
  if (enabled === undefined || enabled === "" || enabled === "false") return undefined;
  if (enabled !== "true") throw new ConfigurationError("API", ["FINANCE_EXPORTS_ENABLED"]);
  const raw = env["FINANCE_EXPORT_MAX_QUEUED"] ?? "";
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new ConfigurationError("API", ["FINANCE_EXPORT_MAX_QUEUED"]);
  }
  const options = s3BlobOptionsFromEnv(env);
  if (options === null) throw new ConfigurationError("API", ["MEDICAL_BLOB_S3_ENDPOINT"]);
  return { maxQueuedPerClinic: value, files: new S3ReportExportFiles(options) };
}
