import type { CashClosing } from "@eyadex/contracts/finance";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { MethodTotal } from "./pg-cash-drawer.ts";

// SQL on the F2 cash closings (0064). Every function runs inside the caller's withTenant(clinicId). A
// closing is append-only: it is never edited or reopened (F2-Q11). Amounts travel as text.

/** A closing as the use case writes it. */
export interface NewClosingRow {
  readonly id: string;
  readonly branchId: string;
  readonly businessDate: string;
  readonly fromCashSeq: bigint;
  readonly toCashSeq: bigint;
  readonly expectedMinor: bigint;
  readonly countedMinor: string;
  readonly methodTotals: readonly MethodTotal[];
  readonly note: string | null;
  readonly previousClosingId: string | null;
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly closedBy: string;
  readonly closedAt: Date;
}

/** Writes the closing; the database computes the difference (counted − expected). */
export async function insertClosing(tx: Tx, clinicId: string, row: NewClosingRow): Promise<void> {
  const at = row.closedAt.toISOString();
  await tx.execute(
    sql`INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq,
          expected_minor, counted_minor, method_totals, note, previous_closing_id, currency,
          currency_exponent, closed_by, closed_at, created_at)
        VALUES (${clinicId}, ${row.id}, ${row.branchId}, ${row.businessDate}::date,
          ${String(row.fromCashSeq)}::bigint, ${String(row.toCashSeq)}::bigint,
          ${String(row.expectedMinor)}::bigint, ${row.countedMinor}::bigint,
          ${JSON.stringify(row.methodTotals)}::jsonb, ${row.note}, ${row.previousClosingId},
          ${row.currency}, ${row.currencyExponent}, ${row.closedBy}, ${at}::timestamptz,
          ${at}::timestamptz)`,
  );
}

/** A closing row as the SELECT below returns it. */
export interface ClosingRaw {
  id: string;
  branch_id: string;
  business_date: string;
  previous_closing_id: string | null;
  from_cash_seq: string;
  to_cash_seq: string;
  expected_minor: string;
  counted_minor: string;
  difference_minor: string;
  method_totals: MethodTotal[];
  note: string | null;
  currency: CurrencyCode;
  currency_exponent: number;
  closed_by: string;
  closed_at: string;
}

/** The closing's columns on the alias `k`. */
export const CLOSING_COLUMNS = sql`k.id, k.branch_id, k.business_date::text AS business_date,
  k.previous_closing_id, k.from_cash_seq::text AS from_cash_seq, k.to_cash_seq::text AS to_cash_seq,
  k.expected_minor::text AS expected_minor, k.counted_minor::text AS counted_minor,
  k.difference_minor::text AS difference_minor, k.method_totals, k.note, k.currency, k.currency_exponent,
  k.closed_by, to_char(k.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at`;

/**
 * A closing as the API answers it, without its movements.
 *
 * @returns the closing
 */
export const toClosing = (row: ClosingRaw): CashClosing => ({
  id: row.id,
  branchId: row.branch_id,
  businessDate: row.business_date,
  previousClosingId: row.previous_closing_id,
  fromCashSeq: row.from_cash_seq,
  toCashSeq: row.to_cash_seq,
  expectedMinor: row.expected_minor,
  countedMinor: row.counted_minor,
  differenceMinor: row.difference_minor,
  methodTotals: row.method_totals,
  note: row.note,
  currency: row.currency,
  currencyExponent: row.currency_exponent,
  closedBy: row.closed_by,
  closedAt: row.closed_at,
});

/**
 * One closing of the clinic.
 *
 * @returns the closing, or null when it is no closing of the clinic
 */
export async function readClosing(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<CashClosing | null> {
  const [row] = await tx.execute<ClosingRaw>(
    sql`SELECT ${CLOSING_COLUMNS} FROM cash_closings k WHERE k.clinic_id = ${clinicId} AND k.id = ${id}`,
  );
  return row === undefined ? null : toClosing(row);
}
