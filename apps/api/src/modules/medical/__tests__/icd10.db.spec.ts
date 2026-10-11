import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  ICD10_SAMPLE,
  icd10OrderLine,
  medicalAudit,
  medicalClinic,
  patientIn,
  seedIcd10,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-F1, R2-8 (ADR-0029): POST /v1/icd10/search answers at most 20 billable codes for a code prefix or
// title words, the query in the body; reference data, so no audit row. The loader's script loads the
// table as the owner, a rerun updates in place, and every load retires the codes its file drops.
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

describe("a newer release (R2-8)", () => {
  it("retires a code the newer file drops: kept unbillable, never searched, icd10_unknown in a diagnosis", async () => {
    const dropped = icd10OrderLine(
      99,
      "K219",
      true,
      "Gastro-esophageal reflux without esophagitis",
    );
    try {
      await seedIcd10(
        h,
        `${ICD10_SAMPLE}
${dropped}`,
        "FY2026",
      );
      expect(codes(await search(C.doctor.cookie, "K21.9"))).toEqual(["K21.9"]);
    } finally {
      // The table is global: the default release is always loaded last, for the next spec files.
      await seedIcd10(h);
    }
    const rows = await h.owner`SELECT billable, release FROM icd10_codes WHERE code = 'K21.9'`;
    expect(rows.map((r) => [r["billable"], r["release"]])).toEqual([[false, "FY2026"]]);
    expect(codes(await search(C.doctor.cookie, "K21.9"))).toEqual([]);
    expect(codes(await search(C.doctor.cookie, "reflux"))).toEqual([]);
    expect(codes(await search(C.doctor.cookie, "I10"))).toEqual(["I10"]);
    const patient = await patientIn(h, C, C.branchD);
    const visit = await startedVisit(h, C.doctor.cookie, {
      patientId: patient,
      branchId: C.branchD,
    });
    const item = { kind: "icd10", code: "K21.9", text: "Reflux" };
    const res = await send(h, C.doctor.cookie, "PUT", `/v1/visits/${visit}/diagnoses`, {
      items: [item],
    });
    expect(code(res)).toBe("icd10_unknown");
  });
});

describe("a corrected file of the same release (R2-8)", () => {
  it("retires a code the corrected file drops, though its release is unchanged", async () => {
    const dropped = icd10OrderLine(98, "K590", true, "Constipation");
    try {
      await seedIcd10(
        h,
        `${ICD10_SAMPLE}
${dropped}`,
      );
      expect(codes(await search(C.doctor.cookie, "K59.0"))).toEqual(["K59.0"]);
    } finally {
      await seedIcd10(h);
    }
    const rows = await h.owner`SELECT billable, release FROM icd10_codes WHERE code = 'K59.0'`;
    expect(rows.map((r) => [r["billable"], r["release"]])).toEqual([[false, "FY2027"]]);
    expect(codes(await search(C.doctor.cookie, "K59.0"))).toEqual([]);
    expect(codes(await search(C.doctor.cookie, "I10"))).toEqual(["I10"]);
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
