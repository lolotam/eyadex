import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { BlobStore } from "../ports/blob-store.ts";

/** Where the owner's Openinary answers, its API key, and an optional folder every key goes under. */
export interface OpeninaryOptions {
  /** The instance origin (https in production; the env reader enforces it, tests use a local server). */
  readonly baseUrl: URL;
  readonly apiKey: string;
  /** `a/b` segments in front of every key, or `null`. */
  readonly folderPrefix: string | null;
  /** Per request; a 20 MB upload to the same server takes about a second. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Openinary answered something this adapter does not accept: never treated as a success. */
export class BlobStoreAnswerError extends Error {
  constructor(operation: "upload" | "download", detail: string) {
    // The detail is a status or a shape name, never a response body, a key or a file's bytes.
    super(`Openinary ${operation}: ${detail}`);
    this.name = "BlobStoreAnswerError";
  }
}

// TODO(spec): verified by the storage spike (plan Task 0). Everything this adapter assumes about
// Openinary lives in this block, from docs.openinary.dev (api-reference/files/upload, files/download,
// introduction), and none of it has been run against the owner's instance yet:
//   1. `POST /upload` takes multipart fields `files` (one part), `folder` and `names`, and stores the part
//      at `<folder>/<names>`. The docs list only image/video/audio/3D types and check each file's first
//      bytes against its claimed type, so an AES-GCM envelope (and an extension-less name) may be
//      refused with 400 — the spike decides between this adapter and the MinIO fallback (spec §6).
//   2. Success is exactly 200 with `{ success: true, files: [{ path }] }`, `path` being the stored path;
//      207 (partial) and every other status are failures.
//   3. `GET /download/<path>` returns the stored bytes unchanged. It is PUBLIC on a self-hosted instance
//      and rate limited per IP (100 per minute by default, `PUBLIC_RATE_LIMIT_MAX`), which is why only
//      ciphertext is ever stored and keys carry no name or patient data.
//   4. The API key is accepted as `Authorization: Bearer <key>` on both routes.
const UPLOAD_PATH = "upload";
const DOWNLOAD_PATH = "download";
const UPLOAD_PART_TYPE = "application/octet-stream";

const split = (fullKey: string): { folder: string; name: string } => {
  const at = fullKey.lastIndexOf("/");
  return { folder: fullKey.slice(0, at), name: fullKey.slice(at + 1) };
};

const uploadForm = (fullKey: string, bytes: Buffer): FormData => {
  const { folder, name } = split(fullKey);
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: UPLOAD_PART_TYPE }), name);
  form.append("folder", folder);
  form.append("names", name);
  return form;
};

const storedPath = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) return null;
  const { success, files } = body as { success?: unknown; files?: unknown };
  if (success !== true || !Array.isArray(files) || files.length !== 1) return null;
  const path = (files[0] as { path?: unknown } | null)?.path;
  return typeof path === "string" ? path : null;
};
// End of the spike assumptions.

/**
 * The attachments' blob store on the owner's self-hosted Openinary (spec §6, P2-F3). Strict: anything but
 * the documented success is an error. A store that cannot be reached or answers 5xx is `503`; any other
 * unexpected answer is an internal error. Nothing of a request or an answer reaches an error message.
 */
export class OpeninaryBlobStore implements BlobStore {
  readonly #options: OpeninaryOptions;

  constructor(options: OpeninaryOptions) {
    this.#options = options;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const fullKey = this.#fullKey(key);
    const res = await this.#request(UPLOAD_PATH, {
      method: "POST",
      body: uploadForm(fullKey, bytes),
    });
    if (res.status !== 200) throw new BlobStoreAnswerError("upload", `status ${res.status}`);
    const body: unknown = await res.json().catch(() => undefined);
    if (storedPath(body) !== fullKey) throw new BlobStoreAnswerError("upload", "unexpected body");
  }

  async get(key: string): Promise<Buffer> {
    const path = this.#fullKey(key).split("/").map(encodeURIComponent).join("/");
    const res = await this.#request(`${DOWNLOAD_PATH}/${path}`, { method: "GET" });
    if (res.status !== 200) throw new BlobStoreAnswerError("download", `status ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  #fullKey(key: string): string {
    const { folderPrefix } = this.#options;
    return folderPrefix === null ? key : `${folderPrefix}/${key}`;
  }

  async #request(path: string, init: { method: string; body?: FormData }): Promise<Response> {
    const url = new URL(path, this.#options.baseUrl.href.replace(/\/?$/, "/"));
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${this.#options.apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      // Unreachable, refused, timed out, or redirected (a redirect could carry the key elsewhere).
      throw new ServiceUnavailableError();
    }
    if (res.status >= 500) {
      await res.body?.cancel();
      throw new ServiceUnavailableError();
    }
    if (res.status !== 200) await res.body?.cancel();
    return res;
  }
}
