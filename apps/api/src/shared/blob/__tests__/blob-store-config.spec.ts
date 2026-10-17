import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ServiceUnavailableError } from "../../errors.ts";
import { blobStoreFromEnv, UnconfiguredBlobStore } from "../blob-store-config.ts";
import { S3BlobStore } from "../s3-blob-store.ts";

// The attachments' store from the environment: all four required values or none, a plain http(s)
// origin, a valid bucket name. An error names the variables, never a value.
const ACCESS_KEY = randomBytes(8).toString("hex");
const SECRET_KEY = randomBytes(16).toString("hex");
const HOST = "blobs.example.internal";
const FULL = {
  MEDICAL_BLOB_S3_ENDPOINT: `http://${HOST}:9000`,
  MEDICAL_BLOB_S3_BUCKET: "eyadex-medical",
  MEDICAL_BLOB_S3_ACCESS_KEY: ACCESS_KEY,
  MEDICAL_BLOB_S3_SECRET_KEY: SECRET_KEY,
};

const startError = (env: Record<string, string>): Error => {
  try {
    blobStoreFromEnv(env);
  } catch (caught) {
    return caught as Error;
  }
  throw new Error(`expected a start error for ${JSON.stringify(Object.keys(env))}`);
};

const expectNoValue = (error: Error): void => {
  for (const secret of [ACCESS_KEY, SECRET_KEY, HOST, "eyadex-medical"]) {
    expect(error.message).not.toContain(secret);
  }
};

describe("blobStoreFromEnv", () => {
  it("is the S3 store with all four values, over http or https, with or without a region", () => {
    expect(blobStoreFromEnv(FULL)).toBeInstanceOf(S3BlobStore);
    expect(
      blobStoreFromEnv({ ...FULL, MEDICAL_BLOB_S3_ENDPOINT: `https://${HOST}/` }),
    ).toBeInstanceOf(S3BlobStore);
    expect(blobStoreFromEnv({ ...FULL, MEDICAL_BLOB_S3_REGION: "me-central-1" })).toBeInstanceOf(
      S3BlobStore,
    );
  });

  it("is the unconfigured store when none is set, which answers 503", async () => {
    const store = blobStoreFromEnv({});
    expect(store).toBeInstanceOf(UnconfiguredBlobStore);
    await expect(store.put("k", Buffer.alloc(1))).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(store.get("k")).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(blobStoreFromEnv({ MEDICAL_BLOB_S3_ENDPOINT: "" })).toBeInstanceOf(
      UnconfiguredBlobStore,
    );
  });

  it("NEGATIVE: refuses to start on a partial configuration, naming each missing variable", () => {
    for (const name of Object.keys(FULL)) {
      const env: Record<string, string> = { ...FULL };
      delete env[name];
      const error = startError(env);
      expect(error.message).toContain(name);
      expectNoValue(error);
    }
    const lone = startError({ MEDICAL_BLOB_S3_REGION: "us-east-1" });
    for (const name of Object.keys(FULL)) expect(lone.message).toContain(name);
    const two = startError({
      MEDICAL_BLOB_S3_SECRET_KEY: SECRET_KEY,
      MEDICAL_BLOB_S3_BUCKET: "b-1",
    });
    expect(two.message).toMatch(/MEDICAL_BLOB_S3_ENDPOINT, MEDICAL_BLOB_S3_ACCESS_KEY must be set/);
    expectNoValue(two);
  });

  it("NEGATIVE: refuses a malformed endpoint, bucket or region, naming only the variable", () => {
    const cases: [Record<string, string>, string][] = [
      [{ MEDICAL_BLOB_S3_ENDPOINT: HOST }, "MEDICAL_BLOB_S3_ENDPOINT"],
      [{ MEDICAL_BLOB_S3_ENDPOINT: `ftp://${HOST}` }, "MEDICAL_BLOB_S3_ENDPOINT"],
      [{ MEDICAL_BLOB_S3_ENDPOINT: `http://u:p@${HOST}` }, "MEDICAL_BLOB_S3_ENDPOINT"],
      [{ MEDICAL_BLOB_S3_ENDPOINT: `http://${HOST}/eyadex-medical` }, "MEDICAL_BLOB_S3_ENDPOINT"],
      [{ MEDICAL_BLOB_S3_ENDPOINT: `http://${HOST}/?k=1` }, "MEDICAL_BLOB_S3_ENDPOINT"],
      [{ MEDICAL_BLOB_S3_BUCKET: "Eyadex_Medical" }, "MEDICAL_BLOB_S3_BUCKET"],
      [{ MEDICAL_BLOB_S3_BUCKET: "ab" }, "MEDICAL_BLOB_S3_BUCKET"],
      [{ MEDICAL_BLOB_S3_REGION: "us east" }, "MEDICAL_BLOB_S3_REGION"],
    ];
    for (const [override, name] of cases) {
      const error = startError({ ...FULL, ...override });
      expect(error.message, JSON.stringify(override)).toContain(name);
      expectNoValue(error);
    }
  });
});
