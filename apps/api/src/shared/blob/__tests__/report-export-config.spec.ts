import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reportExportRuntimeFromEnv } from "../report-export-config.ts";

const configured = () => ({
  FINANCE_EXPORTS_ENABLED: "true",
  FINANCE_EXPORT_MAX_QUEUED: "10",
  MEDICAL_BLOB_S3_ENDPOINT: "http://storage.test:9000",
  MEDICAL_BLOB_S3_BUCKET: "exports-test",
  MEDICAL_BLOB_S3_ACCESS_KEY: randomBytes(12).toString("hex"),
  MEDICAL_BLOB_S3_SECRET_KEY: randomBytes(24).toString("hex"),
});

describe("explicit finance export rollout", () => {
  it("does not mount routes implicitly", () => {
    expect(reportExportRuntimeFromEnv({})).toBeUndefined();
    expect(reportExportRuntimeFromEnv({ FINANCE_EXPORTS_ENABLED: "false" })).toBeUndefined();
  });
  it.each(["", "0", "-1", "1.5", "9007199254740992", "no"])(
    "refuses enabled boot with invalid queue %s",
    (bound) => {
      expect(() =>
        reportExportRuntimeFromEnv({ ...configured(), FINANCE_EXPORT_MAX_QUEUED: bound }),
      ).toThrow("FINANCE_EXPORT_MAX_QUEUED");
    },
  );
  it("requires both the queue and private storage", () => {
    const env = configured();
    delete (env as Partial<typeof env>).FINANCE_EXPORT_MAX_QUEUED;
    expect(() => reportExportRuntimeFromEnv(env)).toThrow("FINANCE_EXPORT_MAX_QUEUED");
    expect(() =>
      reportExportRuntimeFromEnv({
        FINANCE_EXPORTS_ENABLED: "true",
        FINANCE_EXPORT_MAX_QUEUED: "10",
      }),
    ).toThrow("MEDICAL_BLOB_S3_ENDPOINT");
  });
  it("injects the approved 10 explicitly and exposes no API put or tagging operation", () => {
    const runtime = reportExportRuntimeFromEnv(configured())!;
    expect(runtime.maxQueuedPerClinic).toBe(10);
    expect("put" in runtime.files).toBe(false);
    runtime.files.onApplicationShutdown();
  });
});
