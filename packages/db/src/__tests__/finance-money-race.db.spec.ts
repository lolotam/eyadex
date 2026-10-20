import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.ts";
import {
  createOwner,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

// The commit-time money checks (0066) serialise on one clinic-wide advisory lock, so two transactions
// that skip the API's patient lock and reach COMMIT together cannot both spend the same credit
// (PR #92 review): the second one waits, re-reads what the first committed, and is refused.

let owner: Sql;
let A: ClinicFixture;
let app: Database;
let one: Sql;
let two: Sql;
let i1: string;
let i2: string;
let i3: string;
/** The credit both transactions spend. */
let creditId: string;

beforeAll(async () => {
  owner = createOwner();
  [A] = await seedTwoClinics(owner);
  one = postgres(TEST_URLS.appUrl, { max: 1, onnotice: () => undefined });
  two = postgres(TEST_URLS.appUrl, { max: 1, onnotice: () => undefined });
  app = createDatabase({
    url: TEST_URLS.appUrl,
    role: "eyadex_app",
    ids: { newId: newTestId },
  });
  i1 = newTestId();
  i2 = newTestId();
  i3 = newTestId();
  for (const [invoiceId, seq] of [
    [i1, 1],
    [i2, 2],
    [i3, 3],
  ] as const) {
    await owner`INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status,
        source, source_id, issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp,
        tax_minor, total_minor, created_by, created_at, updated_at)
      VALUES (${A.clinicId}, ${invoiceId}, ${A.branchId}, ${A.patientId}, 2026, ${seq}, ${`F2R-${invoiceId}`},
        'issued', 'manual', NULL, now(), 'KWD', 3, 1000, 0, 0, 0, 1000, ${newTestId()}, now(), now())`;
  }
  // A payment of 1000 on i1, fully allocated, and a credit of 1000 released from that allocation: i1 is
  // paid 0 and the patient holds a credit of 1000.
  await app.withTenant(A.clinicId, async (tx) => {
    const paymentId = newTestId();
    const allocationId = newTestId();
    creditId = newTestId();
    await tx.execute(sql`
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number,
          method, amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq,
          received_by, created_at)
      VALUES (${A.clinicId}, ${paymentId}, ${A.branchId}, ${A.patientId}, ${i1}, 2026, 1, ${`R-${paymentId}`},
          'knet', 1000, 'KWD', 3, NULL, now(), current_date, NULL, ${newTestId()}, now())
    `);
    await tx.execute(sql`
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor,
          created_by, created_at)
      VALUES (${A.clinicId}, ${allocationId}, ${i1}, ${A.patientId}, ${paymentId}, NULL, 1000, ${newTestId()}, now())
    `);
    await tx.execute(sql`
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by,
          created_at)
      VALUES (${A.clinicId}, ${creditId}, ${A.patientId}, ${allocationId}, 1000, 'invoice_edited', ${newTestId()}, now())
    `);
  });
});

afterAll(async () => {
  await one.end();
  await two.end();
  await app.close();
  await owner.end();
});

/** A transaction that spends 700 of the credit on one invoice, committed by the client. */
const spend = (
  client: Sql,
  invoiceId: string,
): Promise<"ok" | { code?: string; message?: string }> =>
  client
    .begin(async (tx) => {
      await tx`SELECT set_config('app.clinic_id', ${A.clinicId}, true)`;
      await tx`
        INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor,
            created_by, created_at)
        VALUES (${A.clinicId}, ${newTestId()}, ${invoiceId}, ${A.patientId}, NULL, ${creditId}, 700,
            ${newTestId()}, now())
      `;
      await tx`SELECT set_config('app.clinic_id', '', true)`;
    })
    .then(
      () => "ok" as const,
      (error: unknown) => error as { code?: string; message?: string },
    );

describe("the commit-time money checks serialise on one clinic-wide lock (PR #92 review)", () => {
  it("two transactions spending the same credit cannot both commit", async () => {
    // The holder gets its own client: the owner's pool has one connection, and the count query below
    // needs it while the lock is held.
    const holder = postgres(TEST_URLS.ownerUrl, { max: 1, onnotice: () => undefined });
    let holderEnded = false;
    const endHolder = async (): Promise<void> => {
      if (holderEnded) return;
      holderEnded = true;
      await holder.end({ timeout: 5 });
    };
    try {
      // The check lock is held by another session, so neither transaction can finish its COMMIT.
      await holder`SELECT pg_advisory_lock(hashtextextended(${"finance_check:" + A.clinicId}, 0))`;
      let oneSettled = false;
      let twoSettled = false;
      const onePromise = spend(one, i2).then((result) => {
        oneSettled = true;
        return result;
      });
      const twoPromise = spend(two, i3).then((result) => {
        twoSettled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect([oneSettled, twoSettled]).toEqual([false, false]);
      await holder`SELECT pg_advisory_unlock(hashtextextended(${"finance_check:" + A.clinicId}, 0))`;
      await endHolder();
      const results = await Promise.all([onePromise, twoPromise]);
      expect(results.filter((result) => result === "ok")).toHaveLength(1);
      const failures = results.filter((result) => result !== "ok");
      expect(failures).toHaveLength(1);
      const failure = failures[0] as { code?: string; message?: string };
      expect(failure.code).toBe("P0001");
      expect(failure.message).toBe("finance_invariant");
      // The refused transaction stored nothing: one allocation of the credit is left.
      const rows = await owner<{ n: string }[]>`
        SELECT count(*) AS n FROM payment_allocations WHERE credit_id = ${creditId}
      `;
      expect(Number(rows[0]?.n ?? -1)).toBe(1);
    } finally {
      await endHolder();
    }
  });
});
