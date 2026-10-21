import type { Payment, PaymentMethod } from "@eyadex/contracts/finance";
import type { ReleaseCause } from "@eyadex/contracts/settlement";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL over the F2 money tables (0064): one receipt and the movements of an invoice. Every function runs
// inside the caller's withTenant(clinicId). Amounts travel as text, so a bigint never passes through a
// JS number.

/** A receipt without the patient's name: the name comes from the patients port, in one batch. */
export type PaymentRow = Omit<Payment, "patientName">;

interface PaymentRaw {
  id: string;
  receipt_number: string;
  branch_id: string;
  invoice_id: string;
  invoice_number: string;
  patient_id: string;
  method: PaymentMethod;
  amount_minor: string;
  currency: Payment["currency"];
  currency_exponent: number;
  reference: string | null;
  received_at: string;
  business_date: string;
  cash_seq: string | null;
  received_by: string;
}

/**
 * One receipt with the invoice it names, as the API answers it.
 *
 * @returns the receipt, or null when it is no receipt of the clinic
 */
export async function readPayment(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<PaymentRow | null> {
  const [row] = await tx.execute<PaymentRaw>(
    sql`SELECT p.id, p.receipt_number, p.branch_id, p.invoice_id, i.number AS invoice_number,
          p.patient_id, p.method, p.amount_minor::text AS amount_minor, p.currency, p.currency_exponent,
          p.reference,
          to_char(p.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at,
          p.business_date::text AS business_date, p.cash_seq::text AS cash_seq, p.received_by
        FROM payments p JOIN invoices i ON i.clinic_id = p.clinic_id AND i.id = p.invoice_id
        WHERE p.clinic_id = ${clinicId} AND p.id = ${id}`,
  );
  if (row === undefined) return null;
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    branchId: row.branch_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    patientId: row.patient_id,
    method: row.method,
    amountMinor: row.amount_minor,
    currency: row.currency,
    currencyExponent: row.currency_exponent,
    reference: row.reference,
    receivedAt: row.received_at,
    businessDate: row.business_date,
    cashSeq: row.cash_seq,
    receivedBy: row.received_by,
  };
}

/** One allocation of a credit application: the allocation, the credit it spent and its amount. */
export interface CreditAllocationRow {
  readonly id: string;
  readonly credit_id: string;
  readonly amount_minor: string;
  readonly created_at: string;
}

/**
 * The allocations of these ids, in id order: the answer of a credit application re-reads what it
 * wrote, so the ids it stored are the ids it shows.
 *
 * @param ids the allocation ids; an empty list reads nothing
 * @returns the allocations
 */
export async function readAllocations(
  tx: Tx,
  clinicId: string,
  ids: readonly string[],
): Promise<CreditAllocationRow[]> {
  if (ids.length === 0) return [];
  const list = JSON.stringify(ids);
  return await tx.execute<CreditAllocationRow>(
    sql`SELECT id, credit_id, amount_minor::text AS amount_minor,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
        FROM payment_allocations
        WHERE clinic_id = ${clinicId}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${list}::jsonb))
        ORDER BY id`,
  );
}

/** One movement of an invoice's money: a receipt, a credit applied, a credit released or a refund. */
export type MovementRow =
  | {
      readonly kind: "payment";
      readonly paymentId: string;
      readonly receiptNumber: string;
      readonly method: PaymentMethod;
      readonly amountMinor: string;
      readonly at: string;
      readonly by: string;
    }
  | {
      readonly kind: "credit_applied";
      readonly allocationId: string;
      readonly creditId: string;
      readonly amountMinor: string;
      readonly at: string;
      readonly by: string;
    }
  | {
      readonly kind: "credit_released";
      readonly creditId: string;
      readonly originAllocationId: string;
      readonly amountMinor: string;
      readonly cause: ReleaseCause;
      readonly at: string;
      readonly by: string;
    }
  | {
      readonly kind: "refund";
      readonly refundId: string;
      readonly refundNumber: string;
      readonly method: PaymentMethod;
      readonly amountMinor: string;
      readonly reason: string;
      readonly at: string;
      readonly by: string;
    };

interface MovementPaymentRaw {
  id: string;
  receipt_number: string;
  method: PaymentMethod;
  amount_minor: string;
  at_time: string;
  received_by: string;
}

interface MovementAllocationRaw {
  id: string;
  credit_id: string;
  amount_minor: string;
  at_time: string;
  created_by: string;
}

interface MovementCreditRaw {
  id: string;
  origin_allocation_id: string;
  amount_minor: string;
  cause: ReleaseCause;
  at_time: string;
  created_by: string;
}

interface MovementRefundRaw {
  id: string;
  refund_number: string;
  method: PaymentMethod;
  amount_minor: string;
  reason: string;
  at_time: string;
  refunded_by: string;
}

/** The id of the movement itself: what breaks a tie between two movements of the same instant. */
const movementId = (row: MovementRow): string => {
  switch (row.kind) {
    case "payment":
      return row.paymentId;
    case "credit_applied":
      return row.allocationId;
    case "credit_released":
      return row.creditId;
    case "refund":
      return row.refundId;
  }
};

/**
 * Oldest first, then by the movement's own id: the instants share one UTC format, so the text order is the
 * time order.
 */
const byTimeThenId = (left: MovementRow, right: MovementRow): number => {
  if (left.at !== right.at) return left.at < right.at ? -1 : 1;
  const leftId = movementId(left);
  const rightId = movementId(right);
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
};

/**
 * The movements of one invoice (spec §4.6 `GET /invoices/:id/payments`): its receipts, the credit-funded
 * allocations on it, the credits released from its allocations and the refunds naming it, oldest first.
 * The refundable amount of a payment is added by the use case, which knows the whole patient's money.
 *
 * @returns the movements of the invoice, oldest first
 */
export async function invoiceMovementRows(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
): Promise<MovementRow[]> {
  const payments = await tx.execute<MovementPaymentRaw>(
    sql`SELECT p.id, p.receipt_number, p.method, p.amount_minor::text AS amount_minor,
          to_char(p.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_time,
          p.received_by
        FROM payments p
        WHERE p.clinic_id = ${clinicId} AND p.invoice_id = ${invoiceId}`,
  );
  const allocations = await tx.execute<MovementAllocationRaw>(
    sql`SELECT a.id, a.credit_id, a.amount_minor::text AS amount_minor,
          to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_time,
          a.created_by
        FROM payment_allocations a
        WHERE a.clinic_id = ${clinicId} AND a.invoice_id = ${invoiceId} AND a.credit_id IS NOT NULL`,
  );
  const credits = await tx.execute<MovementCreditRaw>(
    sql`SELECT c.id, c.origin_allocation_id, c.amount_minor::text AS amount_minor, c.cause,
          to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_time,
          c.created_by
        FROM patient_credits c
        JOIN payment_allocations a ON a.clinic_id = c.clinic_id AND a.id = c.origin_allocation_id
        WHERE c.clinic_id = ${clinicId} AND a.invoice_id = ${invoiceId}`,
  );
  const refunds = await tx.execute<MovementRefundRaw>(
    sql`SELECT r.id, r.refund_number, r.method, r.amount_minor::text AS amount_minor, r.reason,
          to_char(r.refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_time,
          r.refunded_by
        FROM refunds r
        WHERE r.clinic_id = ${clinicId} AND r.invoice_id = ${invoiceId}`,
  );
  const movements: MovementRow[] = [
    ...payments.map((row) => ({
      kind: "payment" as const,
      paymentId: row.id,
      receiptNumber: row.receipt_number,
      method: row.method,
      amountMinor: row.amount_minor,
      at: row.at_time,
      by: row.received_by,
    })),
    ...allocations.map((row) => ({
      kind: "credit_applied" as const,
      allocationId: row.id,
      creditId: row.credit_id,
      amountMinor: row.amount_minor,
      at: row.at_time,
      by: row.created_by,
    })),
    ...credits.map((row) => ({
      kind: "credit_released" as const,
      creditId: row.id,
      originAllocationId: row.origin_allocation_id,
      amountMinor: row.amount_minor,
      cause: row.cause,
      at: row.at_time,
      by: row.created_by,
    })),
    ...refunds.map((row) => ({
      kind: "refund" as const,
      refundId: row.id,
      refundNumber: row.refund_number,
      method: row.method,
      amountMinor: row.amount_minor,
      reason: row.reason,
      at: row.at_time,
      by: row.refunded_by,
    })),
  ];
  return movements.sort(byTimeThenId);
}
