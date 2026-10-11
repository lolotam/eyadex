import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { BlobStoreAnswerError, S3BlobStore } from "../s3-blob-store.ts";

// S3BlobStore against a real S3-compatible store (MinIO in CI). The bucket must already exist, as in
// production, where the API never creates it. Without the endpoint the file skips locally, but under CI
// a missing variable fails the run instead of reporting green (vitest.db.config.ts).
const ENDPOINT = process.env["MEDICAL_BLOB_S3_TEST_ENDPOINT"] ?? "";
const NAMES = [
  "MEDICAL_BLOB_S3_TEST_BUCKET",
  "MEDICAL_BLOB_S3_TEST_ACCESS_KEY",
  "MEDICAL_BLOB_S3_TEST_SECRET_KEY",
] as const;

if (ENDPOINT === "" && process.env["CI"] !== undefined) {
  throw new Error("MEDICAL_BLOB_S3_TEST_ENDPOINT is required in CI");
}

const required = (name: (typeof NAMES)[number]): string => {
  const value = process.env[name] ?? "";
  if (value === "") throw new Error(`${name} is required with MEDICAL_BLOB_S3_TEST_ENDPOINT`);
  return value;
};

const newKey = (): string => `clinic/${randomUUID()}/${randomUUID()}`;
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

describe.skipIf(ENDPOINT === "")("S3BlobStore on a real bucket", () => {
  const store =
    ENDPOINT === ""
      ? null
      : new S3BlobStore({
          endpoint: new URL(ENDPOINT),
          bucket: required("MEDICAL_BLOB_S3_TEST_BUCKET"),
          region: "us-east-1",
          accessKey: required("MEDICAL_BLOB_S3_TEST_ACCESS_KEY"),
          secretKey: required("MEDICAL_BLOB_S3_TEST_SECRET_KEY"),
        });
  const live = (): S3BlobStore => {
    if (store === null) throw new Error("unreachable: the suite is skipped without an endpoint");
    return store;
  };

  afterAll(() => store?.onApplicationShutdown());

  it("returns exactly the stored bytes: an empty blob, a short one and a 1 MiB random one", async () => {
    for (const bytes of [Buffer.alloc(0), randomBytes(37), randomBytes(1024 * 1024)]) {
      const key = newKey();
      await live().put(key, bytes);
      const back = await live().get(key);
      expect(back.length).toBe(bytes.length);
      expect(digest(back)).toBe(digest(bytes));
      expect(back.equals(bytes)).toBe(true);
    }
  });

  it("keeps the stored copy when the caller changes its buffer afterwards", async () => {
    const key = newKey();
    const bytes = randomBytes(64);
    const original = Buffer.from(bytes);
    await live().put(key, bytes);
    bytes.fill(0);
    expect((await live().get(key)).equals(original)).toBe(true);
  });

  it("a second put on the same key replaces the content, like the memory store", async () => {
    const key = newKey();
    await live().put(key, randomBytes(128));
    const second = randomBytes(16);
    await live().put(key, second);
    expect((await live().get(key)).equals(second)).toBe(true);
  });

  it("NEGATIVE: a key never stored is a not-found error that does not name the key", async () => {
    const key = newKey();
    const error = await live()
      .get(key)
      .then(
        () => null,
        (caught: unknown) => caught as Error,
      );
    expect(error).toBeInstanceOf(BlobStoreAnswerError);
    expect(error?.message).toMatch(/not found/);
    expect(error?.message).not.toContain(key);
  });
});
