import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientDetailSchema, patientWriteResultSchema } from "@eyadex/contracts/patients";
import { patientListResponseSchema } from "@eyadex/contracts/patients-api";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import {
  code,
  createPatient,
  fakeCivilId,
  filed,
  openPatient,
  patientAudit,
  patientBody,
  patientsClinic,
  search,
  storedCivilId,
  updatePatient,
} from "./patient-fixtures.ts";
import { testCivilIds } from "./civil-id-fixtures.ts";

// ADR-0028, P2-11, P2-F5: the civil ID is stored only encrypted (0052 dropped the plain column) and is
// found by its full number only.
let h: Harness;
let C: Awaited<ReturnType<typeof patientsClinic>>;
let other: Awaited<ReturnType<typeof patientsClinic>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await patientsClinic(h);
  other = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

const found = async (q: string) =>
  patientListResponseSchema
    .parse((await search(h, C.admin.cookie, { q })).json())
    .items.map((p) => p.id);

describe("a file written through the API", () => {
  it("stores the number only as an envelope, its index and its last four digits", async () => {
    const body = patientBody(C.branchR);
    const { id } = await filed(h, C.admin.cookie, body);
    const row = await storedCivilId(h, C.clinicId, id);
    expect(row.civil_id_enc).toMatch(/^f1\.1\./);
    expect(row.civil_id_hmac).toBe(testCivilIds().index(C.clinicId, body.civilId));
    expect(row.civil_id_last4).toBe(body.civilId.slice(-4));
    expect(row.raw).not.toContain(body.civilId);
    const detail = patientDetailSchema.parse((await openPatient(h, C.admin.cookie, id)).json());
    expect(detail.civilId).toBe(body.civilId);
  });

  it("a file without a number stores none of the three columns", async () => {
    const { id } = await filed(h, C.admin.cookie, patientBody(C.branchR, { civilId: "" }));
    expect(await storedCivilId(h, C.clinicId, id)).toMatchObject({
      civil_id_enc: null,
      civil_id_hmac: null,
      civil_id_last4: null,
    });
  });

  it("no audit row of the create, the open or the edit holds the number", async () => {
    const body = patientBody(C.branchR);
    const { id } = await filed(h, C.admin.cookie, body);
    await openPatient(h, C.admin.cookie, id);
    const changed = { ...body, fullName: "Renamed", civilId: fakeCivilId() };
    expect((await updatePatient(h, C.admin.cookie, id, changed)).statusCode).toBe(200);
    const rows = await patientAudit(h, C.clinicId, id);
    expect(rows.map((r) => r["action"])).toEqual([
      "patient.created",
      "patient.opened",
      "patient.updated",
    ]);
    // The whole number and its last six digits: a shorter run could occur by chance inside a UUID.
    for (const number of [body.civilId, changed.civilId]) {
      for (const row of rows) {
        expect(row["raw"]).not.toContain(number);
        expect(row["raw"]).not.toContain(number.slice(-6));
      }
    }
  });
});

describe("search (P2-F5)", () => {
  it("the full number finds the file; part of it does not", async () => {
    const encrypted = patientBody(C.branchR);
    const { id } = await filed(h, C.admin.cookie, encrypted);
    expect(await found(encrypted.civilId)).toEqual([id]);
    // Seven digits from the middle: the birth date part, never inside a 5550… phone or a file number.
    expect(await found(encrypted.civilId.slice(1, 8))).not.toContain(id);
  });

  it("lists show the last four digits, never the number", async () => {
    const encrypted = patientBody(C.branchR);
    const { id } = await filed(h, C.admin.cookie, encrypted);
    const res = await search(h, C.admin.cookie);
    const items = patientListResponseSchema.parse(res.json()).items;
    expect(items.find((p) => p.id === id)?.civilIdLast4).toBe(encrypted.civilId.slice(-4));
    expect(res.body).not.toContain(encrypted.civilId);
  });
});

describe("one number per clinic", () => {
  it("a file blocks a duplicate, with today's masking", async () => {
    const body = patientBody(C.branchX);
    const number = body.civilId;
    const { id: taken } = await filed(h, C.admin.cookie, body);
    const admin = await createPatient(
      h,
      C.admin.cookie,
      patientBody(C.branchR, { civilId: number }),
    );
    expect(admin.statusCode).toBe(409);
    expect(admin.json()).toMatchObject({
      code: "patient_civil_id_taken",
      details: { patientId: taken },
    });
    expect(admin.body).not.toContain(number);
    // Branch X is outside the receptionist's view: the clash is a plain validation error.
    const hidden = await createPatient(
      h,
      C.receptionist.cookie,
      patientBody(C.branchR, { civilId: number }),
    );
    expect(hidden.statusCode).toBe(400);
    expect(hidden.json()).not.toHaveProperty("details");
  });

  it("an encrypted file blocks a duplicate on create and on edit", async () => {
    const body = patientBody(C.branchR);
    const first = await filed(h, C.admin.cookie, body);
    const again = await createPatient(
      h,
      C.admin.cookie,
      patientBody(C.branchR, { civilId: body.civilId }),
    );
    expect(code(again)).toBe("patient_civil_id_taken");
    const second = patientBody(C.branchR);
    const { id } = await filed(h, C.admin.cookie, second);
    const edit = await updatePatient(h, C.admin.cookie, id, { ...second, civilId: body.civilId });
    expect(edit.json()).toMatchObject({
      code: "patient_civil_id_taken",
      details: { patientId: first.id },
    });
  });

  it("the same number in another clinic is allowed, under another index", async () => {
    const body = patientBody(C.branchR);
    const mine = await filed(h, C.admin.cookie, body);
    const theirs = await createPatient(
      h,
      other.admin.cookie,
      patientBody(other.branchR, { civilId: body.civilId }),
    );
    expect(theirs.statusCode).toBe(201);
    const theirId = patientWriteResultSchema.parse(theirs.json()).id;
    const a = await storedCivilId(h, C.clinicId, mine.id);
    const b = await storedCivilId(h, other.clinicId, theirId);
    expect(a.civil_id_hmac).not.toBe(b.civil_id_hmac);
  });
});
