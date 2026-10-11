import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ServiceUnavailableError } from "../../../../shared/errors.ts";
import { blobStoreFromEnv, UnconfiguredBlobStore } from "../blob-store-config.ts";
import { OpeninaryBlobStore } from "../openinary-blob-store.ts";

// The attachments' store from the environment: https only, both values or neither, a safe prefix. An
// error names the variable, never its value.
const API_KEY = randomBytes(16).toString("hex");

describe("blobStoreFromEnv", () => {
  it("is Openinary with an https URL and a key, with or without a folder prefix", () => {
    const base = { MEDICAL_BLOB_URL: "https://files.example.com", MEDICAL_BLOB_API_KEY: API_KEY };
    expect(blobStoreFromEnv(base)).toBeInstanceOf(OpeninaryBlobStore);
    expect(
      blobStoreFromEnv({ ...base, OPENINARY_FOLDER_PREFIX: "eyadex/medical_1" }),
    ).toBeInstanceOf(OpeninaryBlobStore);
  });

  it("is the unconfigured store without either value, which answers 503", async () => {
    const store = blobStoreFromEnv({});
    expect(store).toBeInstanceOf(UnconfiguredBlobStore);
    await expect(store.put("k", Buffer.alloc(1))).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(store.get("k")).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("NEGATIVE: refuses to start on a half or unsafe configuration, naming only the variable", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ MEDICAL_BLOB_API_KEY: API_KEY }, /MEDICAL_BLOB_URL is required/],
      [{ MEDICAL_BLOB_URL: "https://files.example.com" }, /MEDICAL_BLOB_API_KEY is required/],
      [{ MEDICAL_BLOB_URL: "http://files.example.com", MEDICAL_BLOB_API_KEY: API_KEY }, /https/],
      [{ MEDICAL_BLOB_URL: "files.example.com", MEDICAL_BLOB_API_KEY: API_KEY }, /https/],
      [
        { MEDICAL_BLOB_URL: "https://u:p@files.example.com", MEDICAL_BLOB_API_KEY: API_KEY },
        /https/,
      ],
      [
        { MEDICAL_BLOB_URL: "https://files.example.com/?k=1", MEDICAL_BLOB_API_KEY: API_KEY },
        /https/,
      ],
      [
        {
          MEDICAL_BLOB_URL: "https://files.example.com",
          MEDICAL_BLOB_API_KEY: API_KEY,
          OPENINARY_FOLDER_PREFIX: "../up",
        },
        /OPENINARY_FOLDER_PREFIX/,
      ],
      [
        {
          MEDICAL_BLOB_URL: "https://files.example.com",
          MEDICAL_BLOB_API_KEY: API_KEY,
          OPENINARY_FOLDER_PREFIX: "a//b",
        },
        /OPENINARY_FOLDER_PREFIX/,
      ],
    ];
    for (const [env, message] of cases) {
      let error: unknown;
      try {
        blobStoreFromEnv(env);
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(Object.keys(env))).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain(API_KEY);
      expect((error as Error).message).not.toContain("files.example.com");
    }
  });
});
