import { ConfigurationError } from "@eyadex/observability";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  GetBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ExportBlobStore } from "../../finance-exports/ports/export-builder.ts";

export interface ExportS3Options {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

const KEY = /^clinic\/[0-9a-f-]{36}\/finance-exports\/[0-9a-f-]{36}\/[1-5]\.(csv|xlsx)$/;
const requireKey = (key: string) => {
  if (!KEY.test(key)) throw new Error("invalid_export_key");
};
const absent = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

/** Explicit credentials, private requests, export prefix only; no list or attachment deletion. */
export class S3ExportBlobs implements ExportBlobStore {
  readonly #client: S3Client;
  constructor(private readonly options: ExportS3Options) {
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      // Known-length ciphertext already has authenticated records/footer; avoid optional AWS chunk
      // trailers so compatible private stores receive the exact sealed object and ContentLength.
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });
  }

  /** Check metadata before claiming any job; suspending versioning cannot erase old versions. */
  async verifyBucket(): Promise<void> {
    try {
      const result = await this.#client.send(
        new GetBucketVersioningCommand({ Bucket: this.options.bucket }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (result.Status !== undefined) throw new Error("versioned");
    } catch {
      throw new ConfigurationError(
        "worker",
        ["FINANCE_EXPORT_BLOB_S3_BUCKET"],
        "requires a verified never-versioned export bucket",
      );
    }
  }

  /** @inheritdoc */
  async put(
    key: string,
    file: Parameters<ExportBlobStore["put"]>[1],
    signal: AbortSignal,
  ): Promise<void> {
    requireKey(key);
    signal.throwIfAborted();
    const body = file.ciphertext();
    const stop = () => {
      body.destroy();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: body,
          ContentLength: file.storedLength,
          ContentType: "application/octet-stream",
          Tagging: "eyadex-kind=finance-export",
        }),
        { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) },
      );
    } catch {
      throw new Error("export_store_unavailable");
    } finally {
      signal.removeEventListener("abort", stop);
      body.destroy();
    }
  }

  /** @inheritdoc */
  async delete(key: string): Promise<void> {
    requireKey(key);
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (!absent(e)) throw new Error("export_store_unavailable");
    }
  }

  /** @inheritdoc */
  async exists(key: string): Promise<boolean> {
    requireKey(key);
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(30_000),
      });
      return true;
    } catch (e) {
      if (absent(e)) return false;
      throw new Error("export_store_unavailable");
    }
  }

  close(): void {
    this.#client.destroy();
  }
}
