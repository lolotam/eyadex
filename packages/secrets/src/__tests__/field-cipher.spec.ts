import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { civilIdHmac, indexKeyFromEnv } from "../civil-id-index.ts";
import { FieldCipher, fieldCipherFromEnv, strictKey } from "../field-cipher.ts";

// ADR-0028: every clinical value and the civil ID. Keys are generated per run, never written in source.
const k1 = randomBytes(32);
const k2 = randomBytes(32);
const A = "01890000-0000-7000-8000-00000000000a";
const B = "01890000-0000-7000-8000-00000000000b";
const ref = {
  table: "visit_notes",
  column: "plan_enc",
  rowId: "01890000-0000-7000-8000-000000000001",
};
// A made-up value of the right shape; never a real civil ID.
const CIVIL = "289010112345";

const v1 = () => new FieldCipher(new Map([[1, k1]]), 1);

const withPart = (envelope: string, index: number, value: string) => {
  const parts = envelope.split(".");
  parts[index] = value;
  return parts.join(".");
};

describe("FieldCipher", () => {
  it("round-trips, the empty string included (R1-8)", () => {
    const c = v1();
    const sealed = c.seal(A, ref, "خطة العلاج");
    expect(sealed.startsWith("f1.1.")).toBe(true);
    expect(sealed).not.toContain("خطة");
    expect(c.open(A, ref, sealed)).toBe("خطة العلاج");
    expect(c.open(A, ref, c.seal(A, ref, ""))).toBe("");
  });

  it("NEGATIVE: binds the clinic, the table, the column and the row", () => {
    const c = v1();
    const sealed = c.seal(A, ref, "x");
    expect(() => c.open(B, ref, sealed)).toThrow();
    expect(() => c.open(A, { ...ref, table: "visit_addenda" }, sealed)).toThrow();
    expect(() => c.open(A, { ...ref, column: "assessment_enc" }, sealed)).toThrow();
    expect(() => c.open(A, { ...ref, rowId: B }, sealed)).toThrow();
  });

  it("NEGATIVE: refuses a tampered body or tag and another master key", () => {
    const c = v1();
    const sealed = c.seal(A, ref, "x");
    expect(() =>
      c.open(A, ref, withPart(sealed, 3, Buffer.from("y").toString("base64url"))),
    ).toThrow();
    const tag = Buffer.from(sealed.split(".")[4]!, "base64url");
    tag[0] = tag[0]! ^ 1;
    expect(() => c.open(A, ref, withPart(sealed, 4, tag.toString("base64url")))).toThrow();
    expect(() => new FieldCipher(new Map([[1, k2]]), 1).open(A, ref, sealed)).toThrow();
  });

  it("NEGATIVE: refuses a malformed envelope by shape, not by truthiness (R1-8)", () => {
    const c = v1();
    const sealed = c.seal(A, ref, "x");
    const parts = sealed.split(".");
    const short = (n: number) => randomBytes(n).toString("base64url");
    for (const bad of [
      parts.slice(0, 4).join("."),
      `${sealed}.extra`,
      withPart(sealed, 0, "f2"),
      withPart(sealed, 1, "0"),
      withPart(sealed, 1, "x"),
      withPart(sealed, 2, short(11)),
      withPart(sealed, 2, ""),
      withPart(sealed, 4, short(15)),
      withPart(sealed, 4, ""),
    ]) {
      expect(() => c.open(A, ref, bad)).toThrow(/malformed envelope/);
    }
  });

  it("reads every configured version and writes the active one", () => {
    const sealedV1 = v1().seal(A, ref, "v1");
    const rotated = new FieldCipher(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      2,
    );
    expect(rotated.open(A, ref, sealedV1)).toBe("v1");
    expect(rotated.writeVersion).toBe(2);
    expect(rotated.seal(A, ref, "v2").startsWith("f1.2.")).toBe(true);
    expect(() => v1().open(A, ref, rotated.seal(A, ref, "v2"))).toThrow(/unknown key version/);
  });
});

describe("keys from the environment (fail at start)", () => {
  const key = () => randomBytes(32).toString("base64");

  it("builds from MEDICAL_MASTER_KEY_V<n> and MEDICAL_KEY_VERSION, defaulting to version 1", () => {
    expect(fieldCipherFromEnv({ MEDICAL_MASTER_KEY_V1: key() }).writeVersion).toBe(1);
    const env = {
      MEDICAL_KEY_VERSION: "2",
      MEDICAL_MASTER_KEY_V1: key(),
      MEDICAL_MASTER_KEY_V2: key(),
    };
    expect(fieldCipherFromEnv(env).writeVersion).toBe(2);
  });

  it("NEGATIVE: names the missing key or the bad version", () => {
    expect(() => fieldCipherFromEnv({ MEDICAL_KEY_VERSION: "1" })).toThrow(/MEDICAL_MASTER_KEY_V1/);
    expect(() =>
      fieldCipherFromEnv({ MEDICAL_KEY_VERSION: "2", MEDICAL_MASTER_KEY_V1: key() }),
    ).toThrow(/MEDICAL_MASTER_KEY_V2 is missing/);
    for (const version of ["0", "-1", "1.5", "one", "01"]) {
      expect(() =>
        fieldCipherFromEnv({ MEDICAL_KEY_VERSION: version, MEDICAL_MASTER_KEY_V1: key() }),
      ).toThrow(/^MEDICAL_KEY_VERSION must be a positive integer$/);
    }
  });

  it("NEGATIVE: strict base64 of exactly 32 bytes, naming the variable only (R2-9)", () => {
    const good = key();
    const bad = [
      `${good.slice(0, -1)}!`,
      good.slice(0, -1),
      randomBytes(31).toString("base64"),
      randomBytes(33).toString("base64"),
      "c2hvcnQ=",
      `-${good.slice(1)}`,
    ];
    for (const value of bad) {
      expect(() => strictKey("MEDICAL_MASTER_KEY_V1", value)).toThrow(
        /^MEDICAL_MASTER_KEY_V1 must be 32 bytes, base64-encoded$/,
      );
      expect(() =>
        fieldCipherFromEnv({ MEDICAL_KEY_VERSION: "1", MEDICAL_MASTER_KEY_V1: value }),
      ).toThrow(/^MEDICAL_MASTER_KEY_V1 must be 32 bytes, base64-encoded$/);
      expect(() => indexKeyFromEnv({ MEDICAL_INDEX_KEY: value })).toThrow(
        /^MEDICAL_INDEX_KEY must/,
      );
    }
    expect(strictKey("K", good).toString("base64")).toBe(good);
  });

  it("NEGATIVE: the API cannot start without MEDICAL_INDEX_KEY", () => {
    expect(() => indexKeyFromEnv({})).toThrow(/MEDICAL_INDEX_KEY is missing/);
    expect(() => indexKeyFromEnv({ MEDICAL_INDEX_KEY: "" })).toThrow(
      /MEDICAL_INDEX_KEY is missing/,
    );
    const good = key();
    expect(indexKeyFromEnv({ MEDICAL_INDEX_KEY: good }).toString("base64")).toBe(good);
  });
});

describe("civilIdHmac (P2-F5, R1-7)", () => {
  const indexKey = randomBytes(32);

  it("is stable within a clinic, unlinkable across clinics, 64 hex", () => {
    expect(civilIdHmac(indexKey, A, CIVIL)).toBe(civilIdHmac(indexKey, A, CIVIL));
    expect(civilIdHmac(indexKey, A, CIVIL)).not.toBe(civilIdHmac(indexKey, B, CIVIL));
    expect(civilIdHmac(indexKey, A, CIVIL)).not.toBe(civilIdHmac(randomBytes(32), A, CIVIL));
    expect(civilIdHmac(indexKey, A, CIVIL)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never depends on the master keys, so a write-version switch keeps every index", () => {
    const index = randomBytes(32).toString("base64");
    const before = { MEDICAL_INDEX_KEY: index, MEDICAL_MASTER_KEY_V1: k1.toString("base64") };
    const after = {
      ...before,
      MEDICAL_MASTER_KEY_V2: k2.toString("base64"),
      MEDICAL_KEY_VERSION: "2",
    };
    expect(fieldCipherFromEnv(after).writeVersion).toBe(2);
    expect(civilIdHmac(indexKeyFromEnv(after), A, CIVIL)).toBe(
      civilIdHmac(indexKeyFromEnv(before), A, CIVIL),
    );
  });
});
