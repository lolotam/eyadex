import { ConfigurationError } from "@eyadex/observability";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ApiError, ServiceUnavailableError } from "../errors.ts";
import type { S3BlobStoreOptions } from "./s3-blob-store.ts";

const keyAllowed = (key: string) =>
  /^clinic\/[0-9a-f-]{36}\/finance-exports\/[0-9a-f-]{36}\/[1-5]\.(csv|xlsx)$/.test(key);

/** API client for exports: get/delete only, no upload, tagging or bucket listing. */
export class S3ReportExportFiles {
  readonly #client: S3Client;
  constructor(private readonly options: S3BlobStoreOptions) {
    this.#client = new S3Client({
      endpoint: options.endpoint.href,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });
  }

  /** Refuse versioned or suspended buckets before Nest opens the export routes. */
  async onModuleInit(): Promise<void> {
    try {
      const result = await this.#client.send(
        new GetBucketVersioningCommand({ Bucket: this.options.bucket }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (result.Status !== undefined) throw new Error("versioned");
    } catch {
      throw new ConfigurationError(
        "API",
        ["FINANCE_EXPORT_BLOB_S3_BUCKET"],
        "requires a verified never-versioned export bucket",
      );
    }
  }

  async get(key: string): Promise<Buffer> {
    if (!keyAllowed(key)) throw new ApiError("not_found");
    try {
      const result = await this.#client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (result.Body === undefined) throw new ServiceUnavailableError();
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (e) {
      if (status(e) === 404) throw new ApiError("not_found");
      throw new ServiceUnavailableError();
    }
  }

  async delete(key: string): Promise<void> {
    if (!keyAllowed(key)) throw new ApiError("not_found");
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (status(e) !== 404) throw new ServiceUnavailableError();
    }
  }

  onApplicationShutdown(): void {
    this.#client.destroy();
  }
}

function status(e: unknown): number | undefined {
  return typeof e === "object" && e !== null
    ? (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
}
