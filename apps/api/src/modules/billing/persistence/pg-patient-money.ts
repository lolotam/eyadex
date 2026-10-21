import type { PatientMoney, ReleaseCause } from "@eyadex/contracts/settlement";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

// SQL over the F2 money tables (0064): the movements of one patient, or of a few invoices. Every function
// runs inside the caller's withTenant(clinicId). Amounts travel as text and become bigints here, so a
// bigint never passes through a JS number.

// The instants the settlement order reads keep their microseconds, so two movements of the same second
// keep their order.
const instant = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface PaymentRaw {
  id: string;
  invoice_id: string;
  amount_minor: string;
}

interface AllocationRaw {
  id: string;
  invoice_id: string;
  payment_id: string | null;
  credit_id: string | null;
  amount_minor: string;
  created_at: string;
}

interface CreditRaw {
  id: string;
  origin_allocation_id: string;
  amount_minor: string;
  cause: ReleaseCause;
  created_at: string;
}

interface RefundRaw {
  id: string;
  amount_minor: string;
}

interface RefundSourceRaw {
  refund_id: string;
  credit_id: string;
  amount_minor: string;
}

/**
 * Every movement of one patient: the payments, the allocations, the credits, the refunds and the refund
 * sources. Read only after the patient lock (spec §4.4), so the balances are the ones this transaction
 * writes against.
 *
 * @returns the patient's money, as the shared settlement functions read it
 */
export async function readPatientMoney(
  tx: Tx,
  clinicId: string,
  patientId: string,
): Promise<PatientMoney> {
  const payments = await tx.execute<PaymentRaw>(
    sql`SELECT p.id, p.invoice_id, p.amount_minor::text AS amount_minor
        FROM payments p
        WHERE p.clinic_id = ${clinicId} AND p.patient_id = ${patientId}`,
  );
  const allocations = await tx.execute<AllocationRaw>(
    sql`SELECT a.id, a.invoice_id, a.payment_id, a.credit_id, a.amount_minor::text AS amount_minor,
          ${instant(sql`a.created_at`)} AS created_at
        FROM payment_allocations a
        WHERE a.clinic_id = ${clinicId} AND a.patient_id = ${patientId}`,
  );
  const credits = await tx.execute<CreditRaw>(
    sql`SELECT c.id, c.origin_allocation_id, c.amount_minor::text AS amount_minor, c.cause,
          ${instant(sql`c.created_at`)} AS created_at
        FROM patient_credits c
        WHERE c.clinic_id = ${clinicId} AND c.patient_id = ${patientId}`,
  );
  const refunds = await tx.execute<RefundRaw>(
    sql`SELECT r.id, r.amount_minor::text AS amount_minor
        FROM refunds r
        WHERE r.clinic_id = ${clinicId} AND r.patient_id = ${patientId}`,
  );
  const refundSources = await tx.execute<RefundSourceRaw>(
    sql`SELECT s.refund_id, s.credit_id, s.amount_minor::text AS amount_minor
        FROM refund_sources s
        WHERE s.clinic_id = ${clinicId} AND s.patient_id = ${patientId}`,
  );
  return {
    payments: payments.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      amountMinor: BigInt(row.amount_minor),
    })),
    allocations: allocations.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      paymentId: row.payment_id,
      creditId: row.credit_id,
      amountMinor: BigInt(row.amount_minor),
      createdAt: row.created_at,
    })),
    credits: credits.map((row) => ({
      id: row.id,
      originAllocationId: row.origin_allocation_id,
      amountMinor: BigInt(row.amount_minor),
      cause: row.cause,
      createdAt: row.created_at,
    })),
    refunds: refunds.map((row) => ({ id: row.id, amountMinor: BigInt(row.amount_minor) })),
    refundSources: refundSources.map((row) => ({
      refundId: row.refund_id,
      creditId: row.credit_id,
      amountMinor: BigInt(row.amount_minor),
    })),
  };
}

/**
 * The money placed on a few invoices: their allocations and the credits released from those allocations.
 * Enough for `invoicePaid`, `invoiceSettlement` and `paymentRefundable` on these invoices, never for a
 * credit balance — that needs the whole patient (the credit is clinic-wide, F2-Q7).
 *
 * @param invoiceIds the invoices to read; an empty list reads nothing and returns empty money
 * @returns the money of these invoices, as the shared settlement functions read it
 */
export async function readInvoiceMoney(
  tx: Tx,
  clinicId: string,
  invoiceIds: readonly string[],
): Promise<PatientMoney> {
  if (invoiceIds.length === 0) {
    return { payments: [], allocations: [], credits: [], refunds: [], refundSources: [] };
  }
  const ids = JSON.stringify(invoiceIds);
  const allocations = await tx.execute<AllocationRaw>(
    sql`SELECT a.id, a.invoice_id, a.payment_id, a.credit_id, a.amount_minor::text AS amount_minor,
          ${instant(sql`a.created_at`)} AS created_at
        FROM payment_allocations a
        WHERE a.clinic_id = ${clinicId}
          AND a.invoice_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))`,
  );
  const credits = await tx.execute<CreditRaw>(
    sql`SELECT c.id, c.origin_allocation_id, c.amount_minor::text AS amount_minor, c.cause,
          ${instant(sql`c.created_at`)} AS created_at
        FROM patient_credits c
        JOIN payment_allocations a ON a.clinic_id = c.clinic_id AND a.id = c.origin_allocation_id
        WHERE c.clinic_id = ${clinicId}
          AND a.invoice_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))`,
  );
  return {
    payments: [],
    allocations: allocations.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      paymentId: row.payment_id,
      creditId: row.credit_id,
      amountMinor: BigInt(row.amount_minor),
      createdAt: row.created_at,
    })),
    credits: credits.map((row) => ({
      id: row.id,
      originAllocationId: row.origin_allocation_id,
      amountMinor: BigInt(row.amount_minor),
      cause: row.cause,
      createdAt: row.created_at,
    })),
    refunds: [],
    refundSources: [],
  };
}
