import type { PaymentMethod } from "@eyadex/contracts/finance-payments";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL on the F2 refund tables (0064): the refund and the credits it spent. Every function runs inside the
// caller's withTenant(clinicId); the rows are append-only, so nothing here updates or deletes one.

/** The payment a refund gives money back from, read after the invoice lock. */
export interface PaymentForRefund {
  readonly id: string;
  readonly invoiceId: string;
  readonly receiptNumber: string;
  readonly amountMinor: bigint;
}

/**
 * The payment of this clinic a refund names (spec §4.3 "Refund from a payment").
 *
 * @returns the payment, or null when it is no payment of the clinic
 */
export async function paymentForRefund(
  tx: Tx,
  clinicId: string,
  paymentId: string,
): Promise<PaymentForRefund | null> {
  const [row] = await tx.execute<{
    id: string;
    invoice_id: string;
    receipt_number: string;
    amount_minor: string;
  }>(
    sql`SELECT id, invoice_id, receipt_number, amount_minor::text AS amount_minor
        FROM payments WHERE clinic_id = ${clinicId} AND id = ${paymentId}`,
  );
  if (row === undefined) return null;
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    receiptNumber: row.receipt_number,
    amountMinor: BigInt(row.amount_minor),
  };
}

/** A refund as the use case writes it; the cash sequence is null for a non-cash method. */
export interface NewRefundRow {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly invoiceId: string;
  readonly year: number;
  readonly refundSeq: number;
  readonly refundNumber: string;
  readonly method: PaymentMethod;
  readonly amountMinor: string;
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly reason: string;
  readonly refundedAt: Date;
  readonly businessDate: string;
  readonly cashSeq: string | null;
  readonly refundedBy: string;
}

/** Writes the refund; its sources are written after it, because they reference it. */
export async function insertRefund(tx: Tx, clinicId: string, row: NewRefundRow): Promise<void> {
  const at = row.refundedAt.toISOString();
  const cashSeq = row.cashSeq === null ? sql`NULL` : sql`${row.cashSeq}::bigint`;
  await tx.execute(
    sql`INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq,
          refund_number, method, amount_minor, currency, currency_exponent, reason, refunded_at,
          business_date, cash_seq, refunded_by, created_at)
        VALUES (${clinicId}, ${row.id}, ${row.branchId}, ${row.patientId}, ${row.invoiceId}, ${row.year},
          ${row.refundSeq}, ${row.refundNumber}, ${row.method}, ${row.amountMinor}::bigint,
          ${row.currency}, ${row.currencyExponent}, ${row.reason}, ${at}::timestamptz,
          ${row.businessDate}::date, ${cashSeq}, ${row.refundedBy}, ${at}::timestamptz)`,
  );
}

/** One credit a refund spent, and how much of it. */
export interface NewRefundSourceRow {
  readonly id: string;
  readonly refundId: string;
  readonly creditId: string;
  readonly patientId: string;
  readonly amountMinor: string;
  readonly createdAt: Date;
}

/** Writes one source of a refund; Σ sources = the refund's amount (checked again at commit by 0066). */
export async function insertRefundSource(
  tx: Tx,
  clinicId: string,
  row: NewRefundSourceRow,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor,
          created_at)
        VALUES (${clinicId}, ${row.id}, ${row.refundId}, ${row.creditId}, ${row.patientId},
          ${row.amountMinor}::bigint, ${row.createdAt.toISOString()}::timestamptz)`,
  );
}
