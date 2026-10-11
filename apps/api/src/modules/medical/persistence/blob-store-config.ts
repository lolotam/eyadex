import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { BlobStore } from "../ports/blob-store.ts";
import { OpeninaryBlobStore } from "./openinary-blob-store.ts";

// Folder segments only: the prefix becomes part of every stored path, so nothing that could climb out of
// it (`..`), encode, or carry a name.
const PREFIX_SHAPE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

// Same wording as every other startup configuration error of the API: the variable, never its value.
const invalid = (detail: string): Error =>
  new Error(`Invalid API configuration: ${detail} — see .env.example`);

/**
 * The store when nothing is configured: the API still starts (attachments are the only feature that
 * needs it), and an upload or a download answers 503 until the owner pastes the Openinary settings.
 * There is no dedicated error code (the contracts are frozen), so it is `unknown` at 503.
 */
export class UnconfiguredBlobStore implements BlobStore {
  put(): Promise<void> {
    return Promise.reject(new ServiceUnavailableError());
  }

  get(): Promise<Buffer> {
    return Promise.reject(new ServiceUnavailableError());
  }
}

/**
 * The attachments' store from `MEDICAL_BLOB_URL` (https only), `MEDICAL_BLOB_API_KEY` and the optional
 * `OPENINARY_FOLDER_PREFIX`. Neither of the first two set = not configured; one without the other, an
 * http URL, a URL carrying credentials, a query or a fragment, or a malformed prefix stops the start.
 *
 * @param env the process environment
 * @returns the Openinary store, or the unconfigured one
 */
export function blobStoreFromEnv(env: NodeJS.ProcessEnv): BlobStore {
  const rawUrl = env["MEDICAL_BLOB_URL"] ?? "";
  const apiKey = env["MEDICAL_BLOB_API_KEY"] ?? "";
  const rawPrefix = env["OPENINARY_FOLDER_PREFIX"] ?? "";
  if (rawUrl === "" && apiKey === "") return new UnconfiguredBlobStore();
  if (rawUrl === "") throw invalid("MEDICAL_BLOB_URL is required with MEDICAL_BLOB_API_KEY");
  if (apiKey === "") throw invalid("MEDICAL_BLOB_API_KEY is required with MEDICAL_BLOB_URL");
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw invalid("MEDICAL_BLOB_URL must be an https URL");
  }
  const plain = baseUrl.username === "" && baseUrl.password === "";
  if (baseUrl.protocol !== "https:" || !plain || baseUrl.search !== "" || baseUrl.hash !== "") {
    throw invalid("MEDICAL_BLOB_URL must be an https URL");
  }
  if (rawPrefix !== "" && !PREFIX_SHAPE.test(rawPrefix)) {
    throw invalid("OPENINARY_FOLDER_PREFIX must be folder names separated by /");
  }
  return new OpeninaryBlobStore({
    baseUrl,
    apiKey,
    folderPrefix: rawPrefix === "" ? null : rawPrefix,
  });
}
