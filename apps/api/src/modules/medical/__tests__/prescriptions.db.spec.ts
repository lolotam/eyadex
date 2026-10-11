import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  medicalAudit,
  medicalClinic,
  patientIn,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-9, R1-13, R2-10 (ADR-0029): the draft's prescription is replaced whole by the provider, every value
// sealed; a replaced item is archived and never shown; the print answers the clinic, branch, patient,
// provider, dates and active items, and is an audited read that names no medicine.
let h: Harness;
let C: MedicalClinic;

const AMOXI = {
  medicine: "Amoxicillin 500 mg",
  dose: "1 capsule",
  frequency: "every 8 hours",
  duration: "7 days",
  note: "بعد الأكل",
};
const ZINC = {
  medicine: "Zinc oxide cream",
  dose: "",
  frequency: "twice daily",
  duration: "",
  note: null,
};

type Item = typeof AMOXI & { position: number };
type Detail = { content: { prescription: Item[] } };
type Print = {
  clinic: { nameAr: string; nameEn: string };
  branch: { nameAr: string; nameEn: string };
  patient: { fullName: string; fileNumber: number };
  providerName: string;
  startedAt: string;
  signedAt: string | null;
  items: Item[];
};
const detailOf = (res: { json: () => unknown }) => (res.json() as { visit: Detail }).visit;
const save = (cookie: string, id: string, items: unknown[]) =>
  send(h, cookie, "PUT", `/v1/visits/${id}/prescription`, { items });
const print = (cookie: string, id: string) =>
  send(h, cookie, "GET", `/v1/visits/${id}/prescription/print`);
const rowsOf = (id: string) =>
  h.owner`SELECT archived_at, note_enc, row_to_json(p)::text AS raw FROM visit_prescription_items p
          WHERE p.visit_id = ${id} ORDER BY created_at, position`;

let patient: string;
async function walkIn(): Promise<string> {
  return startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  patient = await patientIn(h, C, C.branchD);
});

afterAll(() => closeHarness(h));

describe("PUT /v1/visits/:id/prescription (draft only)", () => {
  it("stores only envelopes (an empty dose too, a blank note as NULL) and logs the field name only", async () => {
    const id = await walkIn();
    const since = new Date();
    const res = await save(C.doctor.cookie, id, [AMOXI, { ...ZINC, note: "  " }]);
    expect(res.statusCode).toBe(200);
    expect(detailOf(res).content.prescription).toEqual([
      { position: 0, ...AMOXI },
      { position: 1, ...ZINC },
    ]);
    const rows = await rowsOf(id);
    expect(rows.map((r) => r["note_enc"] === null)).toEqual([false, true]);
    for (const row of rows) expect(row["raw"]).not.toMatch(/Amoxicillin|Zinc|capsule|الأكل/);
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(audit.map((r) => [r["action"], r["category"], r["entity_type"], r["details"]])).toEqual([
      [
        "visit.prescription_saved",
        "patient_access",
        "prescription",
        { before: null, after: { changed: ["items"] } },
      ],
    ]);
    expect(audit[0]!["raw"]).not.toMatch(/Amoxicillin|Zinc/);
  });

  it("a replace archives the old items; the same list again writes nothing and is logged as an open", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [AMOXI, ZINC]);
    const replaced = await save(C.doctor.cookie, id, [ZINC]);
    expect(detailOf(replaced).content.prescription).toEqual([{ position: 0, ...ZINC }]);
    const since = new Date();
    await save(C.doctor.cookie, id, [ZINC]);
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(
      audit.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]]),
    ).toEqual([["visit.opened", "patient_access", "visit", id]]);
    expect(audit[0]!["details"]).toEqual({ before: null, after: null });
    const rows = await rowsOf(id);
    expect(rows.filter((r) => r["archived_at"] === null)).toHaveLength(1);
    expect(rows.filter((r) => r["archived_at"] !== null)).toHaveLength(2);
  });

  it("refused on a signed visit and to anyone but the provider", async () => {
    const id = await walkIn();
    await send(h, C.doctor.cookie, "PUT", `/v1/visits/${id}/note`, {
      complaint: "x",
      examination: null,
      assessment: null,
      plan: null,
    });
    await send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {});
    expect(code(await save(C.doctor.cookie, id, [AMOXI]))).toBe("visit_signed");
    expect(code(await save(C.doctorB.cookie, id, [AMOXI]))).toBe("not_found");
    expect((await save(C.front.cookie, id, [AMOXI])).statusCode).toBe(403);
    expect(await rowsOf(id)).toEqual([]);
  });
});

describe("GET /v1/visits/:id/prescription/print (R2-10)", () => {
  it("prints a draft with its start date and active items, and audits the read without a medicine", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [AMOXI]);
    await save(C.doctor.cookie, id, [AMOXI, ZINC]);
    const since = new Date();
    const res = await print(C.doctor.cookie, id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Print;
    const [clinic] = await h.owner`SELECT name_ar, name_en FROM clinics WHERE id = ${C.clinicId}`;
    const [file] = await h.owner`SELECT full_name, file_number FROM patients WHERE id = ${patient}`;
    const [visit] = await h.owner`SELECT started_at FROM visits WHERE id = ${id}`;
    expect(body.clinic).toEqual({ nameAr: clinic!["name_ar"], nameEn: clinic!["name_en"] });
    expect(body.branch.nameEn).not.toBe("—");
    expect(body.patient).toEqual({
      fullName: file!["full_name"],
      fileNumber: Number(file!["file_number"]),
    });
    expect(body.providerName).not.toBe("—");
    expect(body.startedAt).toBe((visit!["started_at"] as Date).toISOString());
    expect(body.signedAt).toBeNull();
    expect(body.items).toEqual([
      { position: 0, ...AMOXI },
      { position: 1, ...ZINC },
    ]);
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(
      audit.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]]),
    ).toEqual([["visit.prescription_printed", "patient_access", "prescription", id]]);
    expect(audit[0]!["raw"]).not.toMatch(/Amoxicillin|Zinc/);
  });

  it("a signed visit prints its signing date", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [AMOXI]);
    await send(h, C.doctor.cookie, "PUT", `/v1/visits/${id}/note`, {
      complaint: "x",
      examination: null,
      assessment: null,
      plan: null,
    });
    await send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {});
    const body = (await print(C.doctor.cookie, id)).json() as Print;
    expect(body.signedAt).not.toBeNull();
  });

  it("needs view:medical on the patient: the front desk is forbidden, a stranger doctor not_found", async () => {
    const id = await walkIn();
    expect(code(await print(C.front.cookie, id))).toBe("forbidden");
    expect(code(await print(C.reader.cookie, id))).toBe("forbidden");
    expect(code(await print(C.doctorB.cookie, id))).toBe("not_found");
  });
});
