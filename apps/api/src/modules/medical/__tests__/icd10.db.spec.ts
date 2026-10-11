import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { medicalAudit, medicalClinic, seedIcd10, type MedicalClinic } from "./medical-fixtures.ts";

// P2-F1, R2-8 (ADR-0029): POST /v1/icd10/search answers at most 20 billable codes for a code prefix or
// title words, the query in the body; reference data, so no audit row. The loader's script loads the
// table as the owner and a rerun updates in place.
let h: Harness;
let C: MedicalClinic;

type Result = { items: { code: string; title: string }[]; release: string };
const search = (cookie: string, q: string) => send(h, cookie, "POST", "/v1/icd10/search", { q });
const codes = (res: { json: () => unknown }) => (res.json() as Result).items.map((i) => i.code);

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await seedIcd10(h);
});

afterAll(() => closeHarness(h));

describe("the loader's script (R2-8)", () => {
  it("loaded the header row unbillable and dotted the longer codes, release FY2027; a rerun updates in place", async () => {
    await seedIcd10(h);
    const rows = await h.owner`SELECT code, billable, release FROM icd10_codes
                               WHERE code IN ('F41', 'F41.1', 'I10') ORDER BY code`;
    expect(rows.map((r) => [r["code"], r["billable"], r["release"]])).toEqual([
      ["F41", false, "FY2027"],
      ["F41.1", true, "FY2027"],
      ["I10", true, "FY2027"],
    ]);
  });
});

describe("POST /v1/icd10/search (P2-F1)", () => {
  it("a code prefix answers billable codes only, by code, with the release", async () => {
    const since = new Date();
    const res = await search(C.doctor.cookie, "F41");
    expect(res.statusCode).toBe(200);
    expect(codes(res)).toEqual(["F41.0", "F41.1", "F41.9"]);
    expect((res.json() as Result).release).toBe("ICD-10-CM FY2027");
    expect(await medicalAudit(h, C.clinicId, since)).toEqual([]);
  });

  it("a prefix matches with or without the dot, in any case", async () => {
    expect(codes(await search(C.doctor.cookie, "f411"))).toEqual(["F41.1"]);
    expect(codes(await search(C.doctor.cookie, "F41.9"))).toEqual(["F41.9"]);
    expect(codes(await search(C.doctor.cookie, "i10"))).toEqual(["I10"]);
  });

  it("title words: every word must match; a title starting with the first word ranks first", async () => {
    const res = await search(C.doctor.cookie, "anxiety");
    expect(codes(res)).toEqual(["F41.9", "F41.0", "F41.1"]);
    expect((res.json() as Result).items[0]).toEqual({
      code: "F41.9",
      title: "Anxiety disorder, unspecified",
    });
    expect(codes(await search(C.doctor.cookie, "generalized ANXIETY"))).toEqual(["F41.1"]);
    expect(codes(await search(C.doctor.cookie, "anxiety hypertension"))).toEqual([]);
  });

  it("answers at most 20", async () => {
    const res = await search(C.doctor.cookie, "eyadexfiller condition");
    expect(codes(res)).toHaveLength(20);
    expect(codes(res)[0]).toBe("U99.00");
  });

  it("a typed % or _ is a plain character, not a pattern", async () => {
    expect(codes(await search(C.doctor.cookie, "%"))).toEqual([]);
    expect(codes(await search(C.doctor.cookie, "_"))).toEqual([]);
  });

  it("needs view:medical:*: the front desk and a visits-only reader are forbidden", async () => {
    expect(code(await search(C.front.cookie, "F41"))).toBe("forbidden");
    expect(code(await search(C.reader.cookie, "F41"))).toBe("forbidden");
  });
});
