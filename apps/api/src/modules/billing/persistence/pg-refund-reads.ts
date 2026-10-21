import type { PaymentMethod, Refund } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL over the F2 refunds (0064): one refund, and the columns the refund list reads. Every function runs
// inside the caller's withTenant(clinicId). Amounts travel as text, so a bigint never passes through a
// JS number.

/** A refund without the patient's name: the name comes from the patients port, in one batch. */
export type RefundRow = Omit<Refund, "patientName">;

/** A refund row as the SELECT below returns it. */
export interface RefundRaw {
  id: string;
  refund_number: string;
  branch_id: string;
  invoice_id: string;
  invoice_number: string;
  patient_id: string;
  method: PaymentMethod;
  amount_minor: string;
  currency: Refund["currency"];
  currency_exponent: number;
  reason: string;
  refunded_at: string;
  business_date: string;
  cash_seq: string | null;
  refunded_by: string;
}

/** The refund's columns and its invoice's number, on the aliases `r` (refunds) and `i` (invoices). */
export const REFUND_COLUMNS = sql`r.id, r.refund_number, r.branch_id, r.invoice_id, i.number AS invoice_number,
  r.patient_id, r.method, r.amount_minor::text AS amount_minor, r.currency, r.currency_exponent, r.reason,
  to_char(r.refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS refunded_at,
  r.business_date::text AS business_date, r.cash_seq::text AS cash_seq, r.refunded_by`;

/** The refunds joined to the invoice they were made from, on the aliases `r` and `i`. */
export const REFUNDS_FROM = sql`FROM refunds r JOIN invoices i ON i.clinic_id = r.clinic_id AND i.id = r.invoice_id`;

/**
 * A refund row as the API answers it, before the patient's name is added.
 *
 * @returns the refund
 */
export const toRefundRow = (row: RefundRaw): RefundRow => ({
  id: row.id,
  refundNumber: row.refund_number,
  branchId: row.branch_id,
  invoiceId: row.invoice_id,
  invoiceNumber: row.invoice_number,
  patientId: row.patient_id,
  method: row.method,
  amountMinor: row.amount_minor,
  currency: row.currency,
  currencyExponent: row.currency_exponent,
  reason: row.reason,
  refundedAt: row.refunded_at,
  businessDate: row.business_date,
  cashSeq: row.cash_seq,
  refundedBy: row.refunded_by,
});

/**
 * One refund with the invoice it was made from.
 *
 * @returns the refund, or null when it is no refund of the clinic
 */
export async function readRefund(tx: Tx, clinicId: string, id: string): Promise<RefundRow | null> {
  const [row] = await tx.execute<RefundRaw>(
    sql`SELECT ${REFUND_COLUMNS} ${REFUNDS_FROM} WHERE r.clinic_id = ${clinicId} AND r.id = ${id}`,
  );
  return row === undefined ? null : toRefundRow(row);
}
