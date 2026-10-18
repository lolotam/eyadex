import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  serviceAppointment,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// PR #78 review (ADR-0027): an issue locks its appointment before the patient row, so a cancel that holds
// the row first finishes, and the issue judges the cancelled appointment instead of a stale read.
let h: Harness;
let C: FinanceClinic;

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

async function rowLockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`;
    if ((row!["n"] as number) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${n} row-lock waiters`);
}

describe("an issue racing a cancel of its appointment", () => {
  it("waits for the cancel and answers appointment_not_billable", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "11:30");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const taken = new Promise<void>((resolve) => (locked = resolve));
    const cancel = h.owner.begin(async (sql) => {
      await sql`SELECT id FROM appointments
                WHERE clinic_id = ${C.clinicId} AND id = ${appointment} FOR UPDATE`;
      locked();
      await held;
      await sql`UPDATE appointments SET status = 'cancelled', cancel_reason = 'patient_cancelled'
                WHERE clinic_id = ${C.clinicId} AND id = ${appointment}`;
    });
    await taken;
    const issuing = send(
      h,
      C.admin.cookie,
      "POST",
      "/v1/invoices",
      {
        source: "appointment",
        sourceId: appointment,
        patientId: null,
        branchId: null,
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
    try {
      await rowLockWaiters(1);
    } finally {
      release();
      await cancel;
    }
    const res = await issuing;
    expect([res.statusCode, code(res)]).toEqual([409, "appointment_not_billable"]);
  });
});

// PR #78 review (spec §8 rule 9): a prefix change that waits for a branch's first issue must see that
// issue once it commits. The issue holds the branch row without changing it, so the change judges
// "locked" in a statement taken after its own lock, not in the locking statement's older snapshot.
describe("a prefix change racing the branch's first issue", () => {
  it("waits for the issue and answers invoice_prefix_locked", async () => {
    await h.owner`UPDATE branches SET invoice_prefix = 'RACEX' WHERE id = ${C.branchX}`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const taken = new Promise<void>((resolve) => (locked = resolve));
    const firstIssue = h.owner.begin(async (sql) => {
      await sql`SELECT id FROM branches WHERE clinic_id = ${C.clinicId} AND id = ${C.branchX} FOR SHARE`;
      await sql`INSERT INTO used_invoice_prefixes (clinic_id, id, prefix, branch_id, created_at)
                VALUES (${C.clinicId}, ${randomUUID()}, 'RACEX', ${C.branchX}, now())`;
      locked();
      await held;
    });
    await taken;
    const changing = send(h, C.admin.cookie, "PUT", `/v1/invoice-prefixes/${C.branchX}`, {
      invoicePrefix: "RACEY",
    });
    try {
      await rowLockWaiters(1);
    } finally {
      release();
      await firstIssue;
    }
    const res = await changing;
    expect([res.statusCode, code(res)]).toEqual([409, "invoice_prefix_locked"]);
  });
});
