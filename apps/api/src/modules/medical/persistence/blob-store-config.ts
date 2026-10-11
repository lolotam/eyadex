import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { BlobStore } from "../ports/blob-store.ts";
import { S3BlobStore } from "./s3-blob-store.ts";

// The four values the bucket cannot work without; the region is optional and defaults below.
const REQUIRED = [
  "MEDICAL_BLOB_S3_ENDPOINT",
  "MEDICAL_BLOB_S3_BUCKET",
  "MEDICAL_BLOB_S3_ACCESS_KEY",
  "MEDICAL_BLOB_S3_SECRET_KEY",
] as const;
const REGION = "MEDICAL_BLOB_S3_REGION";
// MinIO ignores the region but signs with it; us-east-1 is what it expects when none is configured.
const DEFAULT_REGION = "us-east-1";

// S3 bucket naming rules (lowercase, digits, dots, hyphens; 3–63 characters).
const BUCKET_SHAPE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_SHAPE = /^[a-z0-9-]+$/;

// Same wording as every other startup configuration error of the API: the variable, never its value.
const invalid = (detail: string): Error =>
  new Error(`Invalid API configuration: ${detail} — see .env.example`);

/**
 * The store when nothing is configured: the API still starts (attachments are the only feature that
 * needs it), and an upload or a download answers 503 until the owner pastes the bucket settings. There
 * is no dedicated error code (the contracts are frozen), so it is `unknown` at 503.
 */
export class UnconfiguredBlobStore implements BlobStore {
  put(): Promise<void> {
    return Promise.reject(new ServiceUnavailableError());
  }

  get(): Promise<Buffer> {
    return Promise.reject(new ServiceUnavailableError());
  }
}

// http is allowed because the bucket is reached on the internal Docker network only; a path, a query,
// a fragment or credentials in the URL would change where requests go or leak into logs.
const endpointFrom = (raw: string): URL => {
  const message = "MEDICAL_BLOB_S3_ENDPOINT must be an http or https origin";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(message);
  }
  const web = url.protocol === "http:" || url.protocol === "https:";
  const plain = url.username === "" && url.password === "";
  if (!web || !plain || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw invalid(message);
  }
  return url;
};

/**
 * The attachments' store from the `MEDICAL_BLOB_S3_*` variables (spec §6). None set = not configured;
 * any set without all four required ones stops the start, naming the missing ones; so do a malformed
 * endpoint, bucket name or region.
 *
 * @param env the process environment
 * @returns the S3 store, or the unconfigured one
 */
export function blobStoreFromEnv(env: NodeJS.ProcessEnv): BlobStore {
  const value = (name: string): string => env[name] ?? "";
  const region = value(REGION);
  const missing = REQUIRED.filter((name) => value(name) === "");
  if (missing.length === REQUIRED.length && region === "") return new UnconfiguredBlobStore();
  if (missing.length > 0) {
    throw invalid(`${missing.join(", ")} must be set with the other MEDICAL_BLOB_S3_* variables`);
  }
  const bucket = value("MEDICAL_BLOB_S3_BUCKET");
  if (!BUCKET_SHAPE.test(bucket)) throw invalid("MEDICAL_BLOB_S3_BUCKET must be an S3 bucket name");
  if (region !== "" && !REGION_SHAPE.test(region)) {
    throw invalid("MEDICAL_BLOB_S3_REGION must be a region name");
  }
  return new S3BlobStore({
    endpoint: endpointFrom(value("MEDICAL_BLOB_S3_ENDPOINT")),
    bucket,
    region: region === "" ? DEFAULT_REGION : region,
    accessKey: value("MEDICAL_BLOB_S3_ACCESS_KEY"),
    secretKey: value("MEDICAL_BLOB_S3_SECRET_KEY"),
  });
}
