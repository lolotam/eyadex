import { randomBytes } from "node:crypto";

import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CIVIL_ID_INDEX_KEY,
  FIELD_CIPHER,
  FieldEncryptionModule,
  readCivilIdIndexKey,
  readFieldCipher,
} from "../field-encryption.module.ts";

// ADR-0028: the clinic area cannot start without valid medical keys, and the error names only the variable.
const key = () => randomBytes(32).toString("base64");

describe("medical keys at startup", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [{ MEDICAL_KEY_VERSION: "1" }, "MEDICAL_MASTER_KEY_V1"],
    [{ MEDICAL_KEY_VERSION: "x", MEDICAL_MASTER_KEY_V1: key() }, "MEDICAL_KEY_VERSION"],
    [{ MEDICAL_MASTER_KEY_V1: "c2hvcnQ=" }, "MEDICAL_MASTER_KEY_V1"],
  ])("NEGATIVE: the cipher refuses %j naming %s only", (env, name) => {
    expect(() => readFieldCipher(env)).toThrow(
      new RegExp(`^Invalid API configuration: ${name}.* — see \\.env\\.example$`),
    );
    expect(() => readFieldCipher(env)).not.toThrow(/c2hvcnQ/);
  });

  it.each([{}, { MEDICAL_INDEX_KEY: "" }, { MEDICAL_INDEX_KEY: "c2hvcnQ=" }])(
    "NEGATIVE: the index key refuses %j naming MEDICAL_INDEX_KEY only",
    (env) => {
      expect(() => readCivilIdIndexKey(env)).toThrow(
        /^Invalid API configuration: MEDICAL_INDEX_KEY.* — see \.env\.example$/,
      );
    },
  );

  it("the module provides one cipher and the index key from the environment", async () => {
    const index = key();
    vi.stubEnv("MEDICAL_MASTER_KEY_V1", key());
    vi.stubEnv("MEDICAL_KEY_VERSION", "1");
    vi.stubEnv("MEDICAL_INDEX_KEY", index);
    const moduleRef = await Test.createTestingModule({
      imports: [FieldEncryptionModule],
    }).compile();
    expect(moduleRef.get(FIELD_CIPHER).writeVersion).toBe(1);
    expect((moduleRef.get(CIVIL_ID_INDEX_KEY) as Buffer).toString("base64")).toBe(index);
    await moduleRef.close();
  });

  it("NEGATIVE: the module fails to build without the index key", async () => {
    vi.stubEnv("MEDICAL_MASTER_KEY_V1", key());
    vi.stubEnv("MEDICAL_INDEX_KEY", "");
    await expect(
      Test.createTestingModule({ imports: [FieldEncryptionModule] }).compile(),
    ).rejects.toThrow(/MEDICAL_INDEX_KEY/);
  });
});
