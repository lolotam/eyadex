import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { BlobStore } from "../ports/blob-store.ts";

/** Where the private bucket answers and the credentials of the one user allowed into it. */
export interface S3BlobStoreOptions {
  /** The S3 origin: on Dokploy the internal service over http, never a public host. */
  readonly endpoint: URL;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  /** Per call, retries included; a 20 MB upload on the same server takes about a second. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const CONTENT_TYPE = "application/octet-stream";

/** The store answered something this adapter does not accept: never treated as a success. */
export class BlobStoreAnswerError extends Error {
  constructor(operation: "upload" | "download", detail: string) {
    // The detail is a status or "not found", never an S3 message: those can echo the key or the bucket.
    super(`Blob store ${operation}: ${detail}`);
    this.name = "BlobStoreAnswerError";
  }
}

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
};

// No status = the store was never reached (refused, DNS, timed out, aborted): 503 like a 5xx. The SDK's
// error is dropped on purpose, not chained as `cause`: its fields can carry the key or the bucket.
const translate = (operation: "upload" | "download", error: unknown): Error => {
  if (error instanceof ServiceUnavailableError) return error;
  const status = statusOf(error);
  if (status === undefined || status >= 500) return new ServiceUnavailableError();
  if (status === 404) return new BlobStoreAnswerError(operation, "not found");
  return new BlobStoreAnswerError(operation, `status ${status}`);
};

/**
 * The attachments' blob store on a private S3-compatible bucket (MinIO on Dokploy, spec §6). Path-style
 * requests, so the bucket never has to resolve as a host name on the internal network. A key that is not
 * there, like any other unexpected answer, is an error; only an unreachable store or a 5xx is `503`.
 */
export class S3BlobStore implements BlobStore {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #timeoutMs: number;

  constructor(options: S3BlobStoreOptions) {
    this.#bucket = options.bucket;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Explicit credentials: the SDK's default chain (env, profile files, instance metadata) is never asked.
    this.#client = new S3Client({
      endpoint: options.endpoint.href,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: CONTENT_TYPE,
    });
    try {
      await this.#client.send(command, { abortSignal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (error) {
      throw translate("upload", error);
    }
  }

  async get(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.#bucket, Key: key });
    try {
      const signal = AbortSignal.timeout(this.#timeoutMs);
      const answer = await this.#client.send(command, { abortSignal: signal });
      if (answer.Body === undefined) throw new BlobStoreAnswerError("download", "empty body");
      return Buffer.from(await answer.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof BlobStoreAnswerError) throw error;
      throw translate("download", error);
    }
  }

  /** Nest calls it on shutdown: the client's kept-alive sockets must not hold the process open. */
  onApplicationShutdown(): void {
    this.#client.destroy();
  }
}
