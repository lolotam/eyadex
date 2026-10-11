import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { addPatient } from "../../appointments/__tests__/appointment-fixtures.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  medicalAudit,
  medicalClinic,
  patientIn,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-7, spec §5 (ADR-0029): the five-section medical file, read with view:medical:*, written with
// update:medical:* (own = the caller's patients), sealed per section, audited as patient access with the
// changed section names only; the platform's window on clinic audit shows none of it.
let h: Harness;
let C: MedicalClinic;
let patient: string;

const ALLERGY = "حساسية من البنسلين";
const FAMILY = "Diabetes (father)";
const EMPTY = {
  allergies: null,
  chronicConditions: null,
  currentMedications: null,
  surgicalHistory: null,
  familyHistory: null,
};
const url = (id: string) => `/v1/patients/${id}/medical-profile`;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  patient = await patientIn(h, C, C.branchD);
  // The walk-in makes the patient the doctor's own (R1-18).
  await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
});

afterAll(() => closeHarness(h));

describe("the medical file", () => {
  it("is five null sections before the first save, and the open is audited", async () => {
    const since = new Date();
    const res = await send(h, C.doctor.cookie, "GET", url(patient));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      profile: EMPTY,
      updatedAt: null,
      updatedByName: null,
      can: { update: true },
    });
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]])).toEqual(
      [["medical_profile.opened", "patient_access", "medical_profile", patient]],
    );
  });

  it("a save seals each section to its row, names the changed sections, and reads back", async () => {
    const since = new Date();
    const body = { ...EMPTY, allergies: ALLERGY, familyHistory: FAMILY };
    const res = await send(h, C.doctor.cookie, "PUT", url(patient), body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ profile: body, can: { update: true } });
    expect((res.json() as { updatedByName: string }).updatedByName).not.toBeNull();
    const [row] =
      await h.owner`SELECT p.*, row_to_json(p)::text AS raw FROM patient_medical_profiles p
                                WHERE p.patient_id = ${patient}`;
    expect(row!["allergies_enc"]).toMatch(/^f1\.[0-9]+\./);
    expect(row!["chronic_conditions_enc"]).toBeNull();
    expect(row!["raw"]).not.toContain("البنسلين");
    expect(row!["raw"]).not.toContain("Diabetes");
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["details"]])).toEqual([
      [
        "medical_profile.saved",
        { before: null, after: { changed: ["allergies", "familyHistory"] } },
      ],
    ]);
    expect(rows[0]!["raw"]).not.toContain("البنسلين");
    const again = await send(h, C.doctor.cookie, "GET", url(patient));
    expect((again.json() as { profile: unknown }).profile).toEqual(body);
  });

  it("own reaches own patients only; an archived file is not written", async () => {
    const stranger = await patientIn(h, C, C.branchD);
    expect((await send(h, C.doctor.cookie, "GET", url(stranger))).statusCode).toBe(404);
    expect((await send(h, C.doctor.cookie, "PUT", url(stranger), EMPTY)).statusCode).toBe(404);
    const archived = await addPatient(h, C.clinicId, C.branchD, "archived");
    await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
                    status, started_at, created_at, updated_at)
                  VALUES (${C.clinicId}, gen_random_uuid(), ${C.branchD}, ${archived},
                    ${C.doctor.memberId}, 'draft', now(), now(), now())`;
    expect(code(await send(h, C.doctor.cookie, "PUT", url(archived), EMPTY))).toBe(
      "patient_inactive",
    );
  });

  it("the admin (no medical key, P2-5) and the front desk are forbidden", async () => {
    for (const cookie of [C.admin.cookie, C.front.cookie, C.reader.cookie]) {
      expect((await send(h, cookie, "GET", url(patient))).statusCode).toBe(403);
      expect((await send(h, cookie, "PUT", url(patient), EMPTY)).statusCode).toBe(403);
    }
  });

  it("the platform's audit window shows none of the medical rows (R1-1)", async () => {
    const platform = postgres(process.env["EYADEX_TEST_PLATFORM_URL"]!, { max: 1 });
    try {
      const [seen] = await platform`SELECT count(*)::int AS n FROM platform_clinic_admin_audit
                                    WHERE clinic_id = ${C.clinicId}
                                      AND (action LIKE 'visit.%' OR action LIKE 'medical_profile.%')`;
      expect(seen!["n"]).toBe(0);
    } finally {
      await platform.end();
    }
    const [written] = await h.owner`SELECT count(*)::int AS n FROM audit_log
                                    WHERE clinic_id = ${C.clinicId}
                                      AND (action LIKE 'visit.%' OR action LIKE 'medical_profile.%')`;
    expect(written!["n"]).toBeGreaterThan(0);
  });
});
