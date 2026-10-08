import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientWriteResultSchema } from "@eyadex/contracts/patients";

import { CLOCK, type Clock } from "../../tenancy/index.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import {
  addBranch,
  code,
  createPatient,
  fakeCivilId,
  fakePhone,
  filed,
  patientAudit,
  patientBody,
  patientsClinic,
  updatePatient,
} from "./patient-fixtures.ts";

// Idempotency, PAT-01, PAT-02 and the duplicate disclosure rule, birth dates, branches (ADR-0018).
let h: Harness;
let C: Awaited<ReturnType<typeof patientsClinic>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

const countFiles = async (clinicId: string) => {
  const [row] =
    await h.owner`SELECT count(*)::int AS n FROM patients WHERE clinic_id = ${clinicId}`;
  return row!["n"] as number;
};

describe("Idempotency-Key on create", () => {
  it("is required (400)", async () => {
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR), null);
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("validation");
  });

  it("a replay returns the first result: one file, one audit row", async () => {
    const key = randomUUID();
    const body = patientBody(C.branchR);
    const before = await countFiles(C.clinicId);
    const first = await createPatient(h, C.admin.cookie, body, key);
    const again = await createPatient(h, C.admin.cookie, body, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(await countFiles(C.clinicId)).toBe(before + 1);
    const { id } = patientWriteResultSchema.parse(first.json());
    expect((await patientAudit(h, C.clinicId, id)).map((r) => r["action"])).toEqual([
      "patient.created",
    ]);
  });

  it("the same key with a different body is idempotency_conflict (409), and creates nothing", async () => {
    const key = randomUUID();
    expect((await createPatient(h, C.admin.cookie, patientBody(C.branchR), key)).statusCode).toBe(
      201,
    );
    const before = await countFiles(C.clinicId);
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR), key);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("idempotency_conflict");
    expect(await countFiles(C.clinicId)).toBe(before);
  });

  it("the key is per caller: another member's same key is a new create", async () => {
    const key = randomUUID();
    const a = await createPatient(h, C.admin.cookie, patientBody(C.branchR), key);
    const b = await createPatient(h, C.receptionist.cookie, patientBody(C.branchR), key);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect((b.json() as { id: string }).id).not.toBe((a.json() as { id: string }).id);
  });
});

describe("PAT-01: file numbers", () => {
  it("are consecutive and distinct for two parallel creates", async () => {
    const [x, y] = await Promise.all([
      createPatient(h, C.admin.cookie, patientBody(C.branchR)),
      createPatient(h, C.admin.cookie, patientBody(C.branchR)),
    ]);
    const numbers = [x, y].map((r) => (r.json() as { fileNumber: number }).fileNumber);
    expect(new Set(numbers).size).toBe(2);
    expect(Math.abs(numbers[0]! - numbers[1]!)).toBe(1);
  });
});

describe("PAT-02: one phone and one civil ID per clinic", () => {
  it("a caller who could open the existing file gets patient_phone_taken with its id", async () => {
    const body = patientBody(C.branchR);
    const first = await filed(h, C.admin.cookie, body);
    const res = await createPatient(
      h,
      C.admin.cookie,
      patientBody(C.branchR, { phone: body.phone }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "patient_phone_taken",
      details: { patientId: first.id, fileNumber: first.fileNumber },
    });
  });

  it("the same for a civil ID, archived files included; the number is never echoed", async () => {
    const body = patientBody(C.branchR);
    const first = await filed(h, C.admin.cookie, body);
    await h.owner`UPDATE patients SET status = 'archived' WHERE id = ${first.id}`;
    const res = await createPatient(
      h,
      C.admin.cookie,
      patientBody(C.branchR, { civilId: body.civilId }),
    );
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("patient_civil_id_taken");
    expect(res.body).not.toContain(body.civilId);
  });

  it("a caller who cannot see the existing file gets plain validation, nothing more", async () => {
    const hidden = patientBody(C.branchX);
    await filed(h, C.admin.cookie, hidden);
    for (const clash of [{ phone: hidden.phone }, { civilId: hidden.civilId }]) {
      const res = await createPatient(h, C.receptionist.cookie, patientBody(C.branchR, clash));
      expect(res.statusCode).toBe(400);
      expect(res.json()).not.toHaveProperty("details");
    }
  });

  it("an update may keep its own phone and civil ID, but not take another file's", async () => {
    const mine = patientBody(C.branchR);
    const theirs = patientBody(C.branchR);
    const own = await filed(h, C.admin.cookie, mine);
    await filed(h, C.admin.cookie, theirs);
    expect((await updatePatient(h, C.admin.cookie, own.id, mine)).statusCode).toBe(200);
    const res = await updatePatient(h, C.admin.cookie, own.id, { ...mine, phone: theirs.phone });
    expect(code(res)).toBe("patient_phone_taken");
  });
});

describe("validation and branches", () => {
  it("refuses an invalid civil ID, one that disagrees with the birth date, and a bad phone", async () => {
    for (const extra of [
      { civilId: "123456789012" },
      { civilId: fakeCivilId("1985-06-15") },
      { phone: "12345" },
    ]) {
      const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, extra));
      expect(res.statusCode, JSON.stringify(Object.keys(extra))).toBe(400);
    }
  });

  it("accepts Arabic-Indic digits in the civil ID and stores ASCII", async () => {
    const civil = fakeCivilId();
    const arabic = civil.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, { civilId: arabic }));
    expect(res.statusCode).toBe(201);
    expect(patientWriteResultSchema.parse(res.json()).detail?.civilId).toBe(civil);
  });

  it("refuses a birth date after today in the clinic's zone, on the injected clock", async () => {
    const clock = h.app.get<Clock>(CLOCK);
    const original = clock.now;
    // 22:30 UTC on 31 Jan is already 1 Feb in Kuwait (UTC+3): 1 Feb is today, 2 Feb is the future.
    clock.now = () => new Date("2026-01-31T22:30:00Z");
    try {
      const today = await createPatient(
        h,
        C.admin.cookie,
        patientBody(C.branchR, { birthDate: "2026-02-01", civilId: "" }),
      );
      expect(today.statusCode).toBe(201);
      const future = await createPatient(
        h,
        C.admin.cookie,
        patientBody(C.branchR, { birthDate: "2026-02-02", civilId: "", phone: fakePhone() }),
      );
      expect(future.statusCode).toBe(400);
    } finally {
      clock.now = original;
    }
  });

  it("an inactive branch is branch_inactive; an unknown one not_found", async () => {
    const inactive = await addBranch(h, C.clinicId, false);
    const res = await createPatient(h, C.admin.cookie, patientBody(inactive));
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("branch_inactive");
    const unknown = await createPatient(h, C.admin.cookie, patientBody(randomUUID()));
    expect(unknown.statusCode).toBe(404);
  });

  it("an update keeping an already-inactive branch is allowed; moving into one is not", async () => {
    const own = await filed(h, C.admin.cookie, patientBody(C.branchR));
    const branch = await addBranch(h, C.clinicId);
    const moved = await updatePatient(h, C.admin.cookie, own.id, patientBody(branch));
    expect(moved.statusCode).toBe(200);
    await h.owner`UPDATE branches SET is_active = false WHERE id = ${branch}`;
    const kept = await updatePatient(h, C.admin.cookie, own.id, patientBody(branch));
    expect(kept.statusCode).toBe(200);
    const other = await filed(h, C.admin.cookie, patientBody(C.branchR));
    const into = await updatePatient(h, C.admin.cookie, other.id, patientBody(branch));
    expect(code(into)).toBe("branch_inactive");
  });

  it("a malformed id is not_found", async () => {
    expect(
      (await updatePatient(h, C.admin.cookie, "not-a-uuid", patientBody(C.branchR))).statusCode,
    ).toBe(404);
  });
});
