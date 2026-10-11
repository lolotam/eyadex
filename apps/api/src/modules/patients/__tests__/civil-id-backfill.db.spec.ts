import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientDetailSchema } from "@eyadex/contracts/patients";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { backfillClinicCivilIds, verifyClinicCivilIds } from "../index.ts";
import { backfillDeps, testCivilIds } from "./civil-id-fixtures.ts";
import {
  addLegacyPatient,
  createPatient,
  fakeCivilId,
  openPatient,
  patientBody,
  patientsClinic,
  storedCivilId,
  updatePatient,
} from "./patient-fixtures.ts";

// ADR-0028, R1-5, R1-6: the one-off conversion of the civil IDs stored before SQL 0045, and the check
// that runs before the plain column is dropped. Each clinic is passed explicitly: the shared test database
// holds other files' clinics, sealed under other runs' keys.
let h: Harness;
let A: Awaited<ReturnType<typeof patientsClinic>>;
let B: Awaited<ReturnType<typeof patientsClinic>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await patientsClinic(h);
  B = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

const detailOf = async (clinic: typeof A, id: string) =>
  patientDetailSchema.parse((await openPatient(h, clinic.admin.cookie, id)).json());

/** Every file of the clinic still in the plain column. */
const plainCount = async (clinicId: string) => {
  const [row] = await h.owner`SELECT count(*)::int AS n FROM patients
                              WHERE clinic_id = ${clinicId} AND civil_id IS NOT NULL`;
  return row!["n"] as number;
};

/**
 * Runs `writers` while the clinic's `patients:` lock is held elsewhere, releasing it only once all of them
 * wait on it, so they race for the lock itself rather than run one after the other.
 */
async function racing(clinicId: string, writers: () => Promise<unknown>[]): Promise<unknown[]> {
  let running: Promise<unknown>[] = [];
  await h.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`patients:${clinicId}`}, 0))`;
    running = writers();
    for (let i = 0; i < 200; i += 1) {
      const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                  WHERE locktype = 'advisory' AND NOT granted`;
      if ((row!["n"] as number) >= running.length) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the writers never queued on the patients lock");
  });
  return Promise.all(running);
}

describe("backfill", () => {
  it("a dry run counts and writes nothing", async () => {
    const id = await addLegacyPatient(h, A.clinicId, A.branchR, fakeCivilId());
    const counts = await backfillClinicCivilIds(backfillDeps(h), A.clinicId, true);
    expect(counts).toEqual({ converted: await plainCount(A.clinicId), collisions: 0 });
    expect((await storedCivilId(h, A.clinicId, id)).civil_id_enc).toBeNull();
  });

  it("converts every plain number of each clinic in batches, keeps it readable, and re-runs as a no-op", async () => {
    const numbers = [fakeCivilId(), fakeCivilId(), fakeCivilId()];
    const inA = await Promise.all(
      numbers.map((number) => addLegacyPatient(h, A.clinicId, A.branchR, number)),
    );
    const inB = await addLegacyPatient(h, B.clinicId, B.branchR, numbers[0]!);
    const plainA = await plainCount(A.clinicId);
    const deps = backfillDeps(h, 2);
    expect(await backfillClinicCivilIds(deps, A.clinicId, false)).toEqual({
      converted: plainA,
      collisions: 0,
    });
    expect(await backfillClinicCivilIds(deps, B.clinicId, false)).toEqual({
      converted: 1,
      collisions: 0,
    });
    for (const [i, id] of inA.entries()) {
      const row = await storedCivilId(h, A.clinicId, id);
      expect(row.civil_id).toBeNull();
      expect(row.civil_id_hmac).toBe(testCivilIds().index(A.clinicId, numbers[i]!));
      expect(row.civil_id_last4).toBe(numbers[i]!.slice(-4));
      expect(row.raw).not.toContain(numbers[i]!);
      expect((await detailOf(A, id)).civilId).toBe(numbers[i]);
    }
    expect((await detailOf(B, inB)).civilId).toBe(numbers[0]);
    expect(await backfillClinicCivilIds(deps, A.clinicId, false)).toEqual({
      converted: 0,
      collisions: 0,
    });
    expect(await plainCount(A.clinicId)).toBe(0);
  });

  it("NEGATIVE: a plain number whose index another file already holds is counted and left", async () => {
    const number = fakeCivilId();
    const legacy = await addLegacyPatient(h, B.clinicId, B.branchR, number);
    // Only a hand-made row can reach this state: every API write checks both forms under the lock.
    const holder = await addLegacyPatient(h, B.clinicId, B.branchR, fakeCivilId());
    const sealed = testCivilIds().columns(B.clinicId, holder, number);
    await h.owner`UPDATE patients SET civil_id = NULL, civil_id_enc = ${sealed.enc},
                    civil_id_hmac = ${sealed.hmac}, civil_id_last4 = ${sealed.last4}
                  WHERE clinic_id = ${B.clinicId} AND id = ${holder}`;
    expect(await backfillClinicCivilIds(backfillDeps(h), B.clinicId, false)).toEqual({
      converted: 0,
      collisions: 1,
    });
    expect((await storedCivilId(h, B.clinicId, legacy)).civil_id).toBe(number);
  });
});

describe("backfill races (R1-5)", () => {
  it("an edit racing the backfill keeps the edit's number, whichever runs first", async () => {
    const legacy = await addLegacyPatient(h, A.clinicId, A.branchR, fakeCivilId());
    const before = await detailOf(A, legacy);
    const edited = fakeCivilId();
    const body = {
      fullName: before.fullName,
      phone: before.phone,
      birthDate: before.birthDate,
      gender: before.gender,
      registrationBranchId: before.registrationBranchId,
      civilId: edited,
    };
    const [edit] = await racing(A.clinicId, () => [
      updatePatient(h, A.admin.cookie, legacy, body),
      backfillClinicCivilIds(backfillDeps(h), A.clinicId, false),
    ]);
    expect(edit).toMatchObject({ statusCode: 200 });
    const row = await storedCivilId(h, A.clinicId, legacy);
    expect(row.civil_id).toBeNull();
    expect(row.civil_id_hmac).toBe(testCivilIds().index(A.clinicId, edited));
    expect((await detailOf(A, legacy)).civilId).toBe(edited);
  });

  it("a create racing the backfill with the same number: exactly one file holds it", async () => {
    const number = fakeCivilId();
    const legacy = await addLegacyPatient(h, A.clinicId, A.branchR, number);
    const [create] = await racing(A.clinicId, () => [
      createPatient(h, A.admin.cookie, patientBody(A.branchR, { civilId: number })),
      backfillClinicCivilIds(backfillDeps(h), A.clinicId, false),
    ]);
    expect(create).toMatchObject({ statusCode: 409 });
    const holders = await h.owner`SELECT id FROM patients WHERE clinic_id = ${A.clinicId}
      AND (civil_id = ${number} OR civil_id_hmac = ${testCivilIds().index(A.clinicId, number)})`;
    expect(holders.map((row) => row["id"])).toEqual([legacy]);
  });
});

describe("--verify (R1-6)", () => {
  it("is clean once converted, and counts plain and mismatched files without naming them", async () => {
    const deps = backfillDeps(h);
    await backfillClinicCivilIds(deps, A.clinicId, false);
    const clean = await verifyClinicCivilIds(deps, A.clinicId);
    expect(clean).toMatchObject({ plain: 0, mismatched: 0 });
    expect(clean.encrypted).toBeGreaterThan(0);

    const plain = await addLegacyPatient(h, A.clinicId, A.branchR, fakeCivilId());
    expect(await verifyClinicCivilIds(deps, A.clinicId)).toMatchObject({ plain: 1, mismatched: 0 });
    await backfillClinicCivilIds(deps, A.clinicId, false);

    const row = await storedCivilId(h, A.clinicId, plain);
    const last4 = row.civil_id_last4 === "0000" ? "0001" : "0000";
    await h.owner`UPDATE patients SET civil_id_last4 = ${last4}
                  WHERE clinic_id = ${A.clinicId} AND id = ${plain}`;
    expect(await verifyClinicCivilIds(deps, A.clinicId)).toMatchObject({ plain: 0, mismatched: 1 });
    // An envelope moved to another file never opens there (it is bound to its own row).
    await h.owner`UPDATE patients SET civil_id_last4 = ${row.civil_id_last4}
                  WHERE clinic_id = ${A.clinicId} AND id = ${plain}`;
    const other = await createPatient(h, A.admin.cookie, patientBody(A.branchR));
    const otherId = (other.json() as { id: string }).id;
    await h.owner`UPDATE patients SET civil_id_enc = ${row.civil_id_enc}
                  WHERE clinic_id = ${A.clinicId} AND id = ${otherId}`;
    expect(await verifyClinicCivilIds(deps, A.clinicId)).toMatchObject({ plain: 0, mismatched: 1 });
  });
});
