import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readExportRuntimeConfig } from "./export-runtime-config.ts";

const configured = () => ({
  FINANCE_EXPORTS_ENABLED: "true",
  MEDICAL_BLOB_S3_ENDPOINT: "http://storage.test:9000",
  MEDICAL_BLOB_S3_BUCKET: "exports-test",
  MEDICAL_BLOB_S3_ACCESS_KEY: randomBytes(12).toString("hex"),
  MEDICAL_BLOB_S3_SECRET_KEY: randomBytes(24).toString("hex"),
});

describe("export worker configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(readExportRuntimeConfig({})).toBeNull();
    expect(readExportRuntimeConfig({ FINANCE_EXPORTS_ENABLED: "false" })).toBeNull();
  });
  it("keeps local concurrency separate from the API queue cap", () => {
    expect(readExportRuntimeConfig(configured())).toMatchObject({
      EXPORT_CONCURRENCY: 2,
      EXPORT_SWEEP_INTERVAL_MS: 60_000,
    });
  });
  it.each(["bad", "http://storage.test/path", "ftp://storage.test"])(
    "rejects unsafe endpoint %s without exposing it",
    (endpoint) => {
      const test = () =>
        readExportRuntimeConfig({ ...configured(), MEDICAL_BLOB_S3_ENDPOINT: endpoint });
      expect(test).toThrow("MEDICAL_BLOB_S3_ENDPOINT");
      try {
        test();
      } catch (e) {
        expect((e as Error).message).not.toContain(endpoint);
      }
    },
  );
  it("rejects credentials in the endpoint without reflecting their values", () => {
    const endpoint = `http://${randomBytes(8).toString("hex")}:${randomBytes(8).toString("hex")}@storage.test`;
    const test = () =>
      readExportRuntimeConfig({ ...configured(), MEDICAL_BLOB_S3_ENDPOINT: endpoint });
    expect(test).toThrow("MEDICAL_BLOB_S3_ENDPOINT");
    try {
      test();
    } catch (e) {
      expect((e as Error).message).not.toContain(endpoint);
    }
  });
  it("refuses missing storage and malformed concurrency", () => {
    expect(() => readExportRuntimeConfig({ FINANCE_EXPORTS_ENABLED: "true" })).toThrow(
      "MEDICAL_BLOB_S3",
    );
    expect(() => readExportRuntimeConfig({ ...configured(), EXPORT_CONCURRENCY: "0" })).toThrow(
      "EXPORT_CONCURRENCY",
    );
  });
});
