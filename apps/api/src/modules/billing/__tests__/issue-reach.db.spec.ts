import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, setPrefixes, type FinanceClinic } from "./billing-fixtures.ts";

// PR #78 review (R1-7, ISO-02): a clinic-wide create key does not widen the patients reach. A manual
// invoice for a file outside the caller's `view:patients` branches is not_found, as if it did not exist.
let h: Harness;
let C: FinanceClinic;
let clerk: { cookie: string };

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  const role = await customRole(h, C.clinicId, [
    "view:patients:branch",
    "view:invoices:clinic",
    "create:invoices:clinic",
  ]);
  clerk = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchD] });
  await invalidate.clinicChanged(C.clinicId);
});

afterAll(() => closeHarness(h));

const manual = (patientId: string, branchId: string) =>
  send(
    h,
    clerk.cookie,
    "POST",
    "/v1/invoices",
    {
      source: "manual",
      sourceId: null,
      patientId,
      branchId,
      lines: [
        {
          kind: "free",
          descriptionAr: "جلسة",
          descriptionEn: "Session",
          quantity: 1,
          unitPriceMinor: "1000",
          discount: null,
        },
      ],
      invoiceDiscount: null,
    },
    randomUUID(),
  );

describe("a manual invoice from a clinic-wide create key", () => {
  it("is not_found for a patient outside the caller's patients branches", async () => {
    const outside = await patientIn(h, C, C.branchR);
    const res = await manual(outside, C.branchR);
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });

  it("is issued for a patient inside them", async () => {
    const inside = await patientIn(h, C, C.branchD);
    expect((await manual(inside, C.branchD)).statusCode).toBe(201);
  });
});

async function rowLockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`;
    if ((row!["n"] as number) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${n} row-lock waiters`);
}

// PR #78 review (Codex P1): the reach was read before the patient row was locked, so a file moved out of
// the caller's branches while the issue waited for that lock was still invoiced on the old reach.
describe("a manual invoice racing a move of its patient to another branch", () => {
  it("waits for the move and answers not_found", async () => {
    const patient = await patientIn(h, C, C.branchD);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const taken = new Promise<void>((resolve) => (locked = resolve));
    const move = h.owner.begin(async (sql) => {
      await sql`SELECT id FROM patients WHERE clinic_id = ${C.clinicId} AND id = ${patient} FOR UPDATE`;
      await sql`UPDATE patients SET registration_branch_id = ${C.branchR}
                WHERE clinic_id = ${C.clinicId} AND id = ${patient}`;
      locked();
      await held;
    });
    await taken;
    const issuing = manual(patient, C.branchD);
    await rowLockWaiters(1);
    release();
    await move;
    const res = await issuing;
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });
});
