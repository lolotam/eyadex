import type { PaymentMethod } from "@eyadex/contracts/finance-payments";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { ReleaseCause } from "@eyadex/contracts/settlement";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { PaymentMethodRow } from "../domain/payment-rules.ts";

// SQL on the F2 money tables (0064): the payment methods setting, the branch's cash drawer, the receipt
// sequences and the money rows themselves. Every function runs inside the caller's withTenant(clinicId).
// The money rows are append-only: nothing here updates or deletes one, only the counters and the switch.

/**
 * The clinic's saved payment methods. A method with no row is enabled (FIN-11), so a clinic that never
 * touched the setting needs no backfill.
 *
 * @returns the saved rows; the empty list means every method is still enabled
 */
export async function paymentMethodRows(tx: Tx, clinicId: string): Promise<PaymentMethodRow[]> {
  const rows = await tx.execute<{ method: PaymentMethod; enabled: boolean }>(
    sql`SELECT method, enabled FROM clinic_payment_methods WHERE clinic_id = ${clinicId}`,
  );
  return rows.map((row) => ({ method: row.method, enabled: row.enabled }));
}

/**
 * Saves the payment methods setting: one row per method, created on the first save and switched after.
 *
 * @param ids the id generator of the caller
 * @param settings the whole list, as the settings screen sends it
 */
export async function savePaymentMethods(
  tx: Tx,
  ids: { newId(): string },
  clinicId: string,
  settings: readonly { readonly method: PaymentMethod; readonly enabled: boolean }[],
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  for (const setting of settings) {
    await tx.execute(
      sql`INSERT INTO clinic_payment_methods (clinic_id, id, method, enabled, created_at, updated_at)
          VALUES (${clinicId}, ${ids.newId()}, ${setting.method}, ${setting.enabled},
            ${at}::timestamptz, ${at}::timestamptz)
          ON CONFLICT (clinic_id, method) DO UPDATE
            SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
    );
  }
}

/** What the money of one invoice needs: its number, its total, its currency and the clinic's timezone. */
export interface InvoiceMoneyFacts {
  readonly number: string;
  readonly totalMinor: string;
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly timezone: string;
}

/**
 * The invoice's money facts with the clinic's timezone, so the business day and the receipt year come from
 * the clinic's own clock (R1-8). The caller reads it after the invoice row lock.
 *
 * @returns the invoice's facts; the caller has already found the invoice
 */
export async function invoiceMoneyFacts(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
): Promise<InvoiceMoneyFacts> {
  const [row] = await tx.execute<{
    number: string;
    total_minor: string;
    currency: CurrencyCode;
    currency_exponent: number;
    timezone: string;
  }>(
    sql`SELECT i.number, i.total_minor::text AS total_minor, i.currency, i.currency_exponent,
          c.timezone
        FROM invoices i JOIN clinics c ON c.id = i.clinic_id
        WHERE i.clinic_id = ${clinicId} AND i.id = ${invoiceId}`,
  );
  return {
    number: row!.number,
    totalMinor: row!.total_minor,
    currency: row!.currency,
    currencyExponent: row!.currency_exponent,
    timezone: row!.timezone,
  };
}

/**
 * The next cash position of the branch (spec §4.4): the drawer row is created if missing, then locked and
 * advanced in the writing transaction. The drawer row serialises a branch's cash, so every cash movement
 * holds exactly one number and a cash movement is in exactly one closing (ADR-0027 item 9a).
 *
 * @returns the cash sequence this movement takes, as text
 */
export async function takeCashSeq(
  tx: Tx,
  ids: { newId(): string },
  clinicId: string,
  branchId: string,
  now: Date,
): Promise<string> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq,
          last_closing_id, created_at, updated_at)
        VALUES (${clinicId}, ${ids.newId()}, ${branchId}, 0, 0, NULL, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT (clinic_id, branch_id) DO NOTHING`,
  );
  await tx.execute(
    sql`SELECT id FROM branch_cash_drawers
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} FOR UPDATE`,
  );
  const [row] = await tx.execute<{ last_cash_seq: string }>(
    sql`UPDATE branch_cash_drawers SET last_cash_seq = last_cash_seq + 1, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId}
        RETURNING last_cash_seq::text AS last_cash_seq`,
  );
  return row!.last_cash_seq;
}

/**
 * The next number of the branch, series and year (R1-9, ADR-0027 item 9c): the sequence row is created if
 * missing, then locked, read and advanced in the writing transaction, so the numbers stay gap-free and a
 * rolled-back payment gives its number back.
 *
 * @param series the receipt series or the refund series (F2-Q13)
 * @returns the number this movement takes
 */
export async function takeReceiptSeq(
  tx: Tx,
  ids: { newId(): string },
  clinicId: string,
  branchId: string,
  series: "receipt" | "refund",
  year: number,
  now: Date,
): Promise<number> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO receipt_sequences (clinic_id, id, branch_id, series, year, next_number, created_at,
          updated_at)
        VALUES (${clinicId}, ${ids.newId()}, ${branchId}, ${series}, ${year}, 1, ${at}::timestamptz,
          ${at}::timestamptz)
        ON CONFLICT (clinic_id, branch_id, series, year) DO NOTHING`,
  );
  const [row] = await tx.execute<{ next_number: number }>(
    sql`SELECT next_number FROM receipt_sequences
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} AND series = ${series}
          AND year = ${year}
        FOR UPDATE`,
  );
  await tx.execute(
    sql`UPDATE receipt_sequences SET next_number = next_number + 1, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} AND series = ${series} AND year = ${year}`,
  );
  return row!.next_number;
}

/** A receipt as the payment writes it; the cash sequence is null for a non-cash method. */
export interface NewPaymentRow {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly invoiceId: string;
  readonly year: number;
  readonly receiptSeq: number;
  readonly receiptNumber: string;
  readonly method: PaymentMethod;
  readonly amountMinor: string;
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly reference: string | null;
  readonly receivedAt: Date;
  readonly businessDate: string;
  readonly cashSeq: string | null;
  readonly receivedBy: string;
}

/** Writes the receipt; the row is append-only, so a correction is a refund and a new receipt (F2-Q12). */
export async function insertPayment(tx: Tx, clinicId: string, row: NewPaymentRow): Promise<void> {
  const at = row.receivedAt.toISOString();
  const cashSeq = row.cashSeq === null ? sql`NULL` : sql`${row.cashSeq}::bigint`;
  await tx.execute(
    sql`INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq,
          receipt_number, method, amount_minor, currency, currency_exponent, reference, received_at,
          business_date, cash_seq, received_by, created_at)
        VALUES (${clinicId}, ${row.id}, ${row.branchId}, ${row.patientId}, ${row.invoiceId}, ${row.year},
          ${row.receiptSeq}, ${row.receiptNumber}, ${row.method}, ${row.amountMinor}::bigint,
          ${row.currency}, ${row.currencyExponent}, ${row.reference}, ${at}::timestamptz,
          ${row.businessDate}::date, ${cashSeq}, ${row.receivedBy}, ${at}::timestamptz)`,
  );
}

/** An allocation as it is written: funded by exactly one payment or one credit. */
export interface NewAllocationRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly paymentId: string | null;
  readonly creditId: string | null;
  readonly amountMinor: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** Writes the money placed on an invoice; the row is append-only, like every money row. */
export async function insertAllocation(
  tx: Tx,
  clinicId: string,
  row: NewAllocationRow,
): Promise<void> {
  const at = row.createdAt.toISOString();
  await tx.execute(
    sql`INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id,
          amount_minor, created_by, created_at)
        VALUES (${clinicId}, ${row.id}, ${row.invoiceId}, ${row.patientId}, ${row.paymentId},
          ${row.creditId}, ${row.amountMinor}::bigint, ${row.createdBy}, ${at}::timestamptz)`,
  );
}

/** A credit as it is written: money released from an allocation and owed back to the patient. */
export interface NewCreditRow {
  readonly id: string;
  readonly patientId: string;
  readonly originAllocationId: string;
  readonly amountMinor: string;
  readonly cause: ReleaseCause;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** Writes the credit; the row is append-only, like every money row. */
export async function insertCredit(tx: Tx, clinicId: string, row: NewCreditRow): Promise<void> {
  const at = row.createdAt.toISOString();
  await tx.execute(
    sql`INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor,
          cause, created_by, created_at)
        VALUES (${clinicId}, ${row.id}, ${row.patientId}, ${row.originAllocationId},
          ${row.amountMinor}::bigint, ${row.cause}, ${row.createdBy}, ${at}::timestamptz)`,
  );
}
