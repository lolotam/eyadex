import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, DatabaseError, type Database, type Tx } from "../index.ts";
import {
  createOwner,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

// 0066's commit-time checks (finance spec §4.3, R3-1, R3-2, #91, F2-Q17) run at the real COMMIT of
// `withTenant`, after the wrapper has cleared app.clinic_id, as eyadex_app, which holds no EXECUTE on any
// check function: the database re-checks the money, it does not trust the code that wrote it.

let owner: Sql;
let A: ClinicFixture;
let app: Database;
let invoiceId: string;
/** The allocation of the first case; the later cases spend what it holds. */
let paidAllocationId: string;

beforeAll(async () => {
  owner = createOwner();
  [A] = await seedTwoClinics(owner);
  invoiceId = newTestId();
  await owner`INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status,
      source, source_id, issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp,
      tax_minor, total_minor, created_by, created_at, updated_at)
    VALUES (${A.clinicId}, ${invoiceId}, ${A.branchId}, ${A.patientId}, 2026, 1, ${`F2-${invoiceId}`}, 'issued',
      'manual', NULL, now(), 'KWD', 3, 10000, 0, 0, 0, 10000, ${newTestId()}, now(), now())`;
  app = createDatabase({
    url: TEST_URLS.appUrl,
    role: "eyadex_app",
    ids: { newId: newTestId },
  });
});

afterAll(async () => {
  await app.close();
  await owner.end();
});

const caught = async (work: Promise<unknown>): Promise<DatabaseError> => {
  let failure: unknown;
  try {
    await work;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DatabaseError);
  return failure as DatabaseError;
};

const paymentRows = async (id: string): Promise<number> => {
  const rows = await owner<{ n: string }[]>`SELECT count(*) AS n FROM payments WHERE id = ${id}`;
  return Number(rows[0]?.n ?? -1);
};

const allocationRows = async (id: string): Promise<number> => {
  const rows = await owner<
    { n: string }[]
  >`SELECT count(*) AS n FROM payment_allocations WHERE id = ${id}`;
  return Number(rows[0]?.n ?? -1);
};

const creditRows = async (id: string): Promise<number> => {
  const rows = await owner<
    { n: string }[]
  >`SELECT count(*) AS n FROM patient_credits WHERE id = ${id}`;
  return Number(rows[0]?.n ?? -1);
};

const refundRows = async (id: string): Promise<number> => {
  const rows = await owner<{ n: string }[]>`SELECT count(*) AS n FROM refunds WHERE id = ${id}`;
  return Number(rows[0]?.n ?? -1);
};

const invoiceTotal = async (id: string): Promise<string> => {
  const rows = await owner<
    { total_minor: string }[]
  >`SELECT total_minor FROM invoices WHERE id = ${id}`;
  return String(rows[0]?.total_minor ?? "-1");
};

const insertPayment = async (
  tx: Tx,
  id: string,
  receiptSeq: number,
  amount: number,
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number,
        method, amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq,
        received_by, created_at)
    VALUES (${A.clinicId}, ${id}, ${A.branchId}, ${A.patientId}, ${invoiceId}, 2026, ${receiptSeq},
        ${`R-${id}`}, 'knet', ${amount}, 'KWD', 3, NULL, now(), current_date, NULL, ${newTestId()}, now())
  `);
};

const insertAllocation = async (
  tx: Tx,
  id: string,
  paymentId: string,
  amount: number,
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor,
        created_by, created_at)
    VALUES (${A.clinicId}, ${id}, ${invoiceId}, ${A.patientId}, ${paymentId}, NULL, ${amount}, ${newTestId()}, now())
  `);
};

const insertCredit = async (
  tx: Tx,
  id: string,
  originAllocationId: string,
  amount: number,
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by,
        created_at)
    VALUES (${A.clinicId}, ${id}, ${A.patientId}, ${originAllocationId}, ${amount}, 'refund', ${newTestId()}, now())
  `);
};

const insertRefund = async (
  tx: Tx,
  id: string,
  refundSeq: number,
  amount: number,
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number,
        method, amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq,
        refunded_by, created_at)
    VALUES (${A.clinicId}, ${id}, ${A.branchId}, ${A.patientId}, ${invoiceId}, 2026, ${refundSeq},
        ${`RF-${id}`}, 'knet', ${amount}, 'KWD', 3, 'x', now(), current_date, NULL, ${newTestId()}, now())
  `);
};

const insertRefundSource = async (
  tx: Tx,
  id: string,
  refundId: string,
  creditId: string,
  amount: number,
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
    VALUES (${A.clinicId}, ${id}, ${refundId}, ${creditId}, ${A.patientId}, ${amount}, now())
  `);
};

describe("the money checks run at the real COMMIT (0066)", () => {
  it("commits a payment placed in full", async () => {
    const paymentId = newTestId();
    const allocationId = newTestId();
    paidAllocationId = allocationId;
    await app.withTenant(A.clinicId, async (tx) => {
      await insertPayment(tx, paymentId, 1, 4000);
      await insertAllocation(tx, allocationId, paymentId, 4000);
    });
    expect(await paymentRows(paymentId)).toBe(1);
    expect(await allocationRows(allocationId)).toBe(1);
  });

  it("refuses at COMMIT a payment that is not placed in full", async () => {
    const paymentId = newTestId();
    const allocationId = newTestId();
    const failure = await caught(
      app.withTenant(A.clinicId, async (tx) => {
        await insertPayment(tx, paymentId, 2, 1000);
        await insertAllocation(tx, allocationId, paymentId, 600);
      }),
    );
    expect(failure.code).toBe("P0001");
    expect(await paymentRows(paymentId)).toBe(0);
    expect(await allocationRows(allocationId)).toBe(0);
  });

  it("refuses at COMMIT a refund with no source", async () => {
    const creditId = newTestId();
    const refundId = newTestId();
    const failure = await caught(
      app.withTenant(A.clinicId, async (tx) => {
        await insertCredit(tx, creditId, paidAllocationId, 500);
        await insertRefund(tx, refundId, 1, 500);
      }),
    );
    expect(failure.code).toBe("P0001");
    expect(await creditRows(creditId)).toBe(0);
    expect(await refundRows(refundId)).toBe(0);
  });

  it("refuses at COMMIT a refund whose sources do not add up", async () => {
    const creditId = newTestId();
    const refundId = newTestId();
    const sourceId = newTestId();
    const failure = await caught(
      app.withTenant(A.clinicId, async (tx) => {
        await insertCredit(tx, creditId, paidAllocationId, 500);
        await insertRefund(tx, refundId, 2, 500);
        await insertRefundSource(tx, sourceId, refundId, creditId, 300);
      }),
    );
    expect(failure.code).toBe("P0001");
    expect(await creditRows(creditId)).toBe(0);
    expect(await refundRows(refundId)).toBe(0);
  });

  it("#91: refuses at COMMIT a refund of more than the payment", async () => {
    const creditId = newTestId();
    const refundId = newTestId();
    const sourceId = newTestId();
    const failure = await caught(
      app.withTenant(A.clinicId, async (tx) => {
        await insertCredit(tx, creditId, paidAllocationId, 4001);
        await insertRefund(tx, refundId, 3, 4001);
        await insertRefundSource(tx, sourceId, refundId, creditId, 4001);
      }),
    );
    expect(failure.code).toBe("P0001");
    expect(await creditRows(creditId)).toBe(0);
    expect(await refundRows(refundId)).toBe(0);
  });

  it("commits a refund from the payment (§4.3 S8)", async () => {
    const creditId = newTestId();
    const refundId = newTestId();
    const sourceId = newTestId();
    await app.withTenant(A.clinicId, async (tx) => {
      await insertCredit(tx, creditId, paidAllocationId, 1000);
      await insertRefund(tx, refundId, 4, 1000);
      await insertRefundSource(tx, sourceId, refundId, creditId, 1000);
    });
    expect(await refundRows(refundId)).toBe(1);
  });

  it("refuses at COMMIT lowering the invoice below what it holds", async () => {
    const failure = await caught(
      app.withTenant(A.clinicId, async (tx) => {
        await tx.execute(sql`
          UPDATE invoices SET total_minor = 2000, subtotal_minor = 2000 WHERE id = ${invoiceId}
        `);
      }),
    );
    expect(failure.code).toBe("P0001");
    expect(await invoiceTotal(invoiceId)).toBe("10000");
  });
});
