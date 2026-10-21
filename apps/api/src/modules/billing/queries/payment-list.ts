import type { Payment, PaymentListQuery } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import type { BillingPatientReader } from "../ports/billing-patients.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function filters(clinicId: string, query: PaymentListQuery, reach: SQL): SQL[] {
  const where = [sql`p.clinic_id = ${clinicId}`, reach];
  if (query.branchId !== undefined) where.push(sql`p.branch_id = ${query.branchId}`);
  if (query.method !== undefined) where.push(sql`p.method = ${query.method}`);
  if (query.patientId !== undefined) where.push(sql`p.patient_id = ${query.patientId}`);
  if (query.invoiceId !== undefined) where.push(sql`p.invoice_id = ${query.invoiceId}`);
  if (query.receiptNumber !== undefined) {
    where.push(sql`p.receipt_number ILIKE ${`%${escapeLike(query.receiptNumber)}%`}`);
  }
  // The days are the clinic's own business days (spec §4.6), already stored in the clinic's timezone.
  if (query.from !== undefined) where.push(sql`p.business_date >= ${query.from}::date`);
  if (query.to !== undefined) where.push(sql`p.business_date <= ${query.to}::date`);
  return where;
}

interface Row {
  id: string;
  receipt_number: string;
  branch_id: string;
  invoice_id: string;
  invoice_number: string;
  patient_id: string;
  method: Payment["method"];
  amount_minor: string;
  currency: Payment["currency"];
  currency_exponent: number;
  reference: string | null;
  received_at: string;
  business_date: string;
  cash_seq: string | null;
  received_by: string;
}

const toPayment = (row: Row, patientName: string): Payment => ({
  id: row.id,
  receiptNumber: row.receipt_number,
  branchId: row.branch_id,
  invoiceId: row.invoice_id,
  invoiceNumber: row.invoice_number,
  patientId: row.patient_id,
  patientName,
  method: row.method,
  amountMinor: row.amount_minor,
  currency: row.currency,
  currencyExponent: row.currency_exponent,
  reference: row.reference,
  receivedAt: row.received_at,
  businessDate: row.business_date,
  cashSeq: row.cash_seq,
  receivedBy: row.received_by,
});

/**
 * `GET /v1/payments`: newest first, a page and the total that matches, inside the caller's reach.
 *
 * @param reach the caller's view condition on the alias `p`
 * @returns the page, the next cursor and the total
 */
export async function listPayments(
  tx: Tx,
  clinicId: string,
  query: PaymentListQuery,
  reach: SQL,
  patients: Pick<BillingPatientReader, "displayNames">,
): Promise<{ items: Payment[]; nextCursor: string | null; total: number }> {
  const where = filters(clinicId, query, reach);
  const from = sql`FROM payments p JOIN invoices i ON i.clinic_id = p.clinic_id AND i.id = p.invoice_id`;
  const [count] = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total ${from} WHERE ${sql.join(where, sql` AND `)}`,
  );
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  // A cursor this list never made is refused, like every other list, instead of restarting at page one.
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  const page = after === null ? where : [...where, sql`p.id < ${after}::uuid`];
  const rows = await tx.execute<Row>(
    sql`SELECT p.id, p.receipt_number, p.branch_id, p.invoice_id, i.number AS invoice_number,
          p.patient_id, p.method, p.amount_minor::text AS amount_minor, p.currency, p.currency_exponent,
          p.reference,
          to_char(p.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at,
          p.business_date::text AS business_date, p.cash_seq::text AS cash_seq, p.received_by
        ${from} WHERE ${sql.join(page, sql` AND `)}
        ORDER BY p.id DESC LIMIT ${query.limit + 1}`,
  );
  const pageRows = rows.slice(0, query.limit);
  const names = await patients.displayNames(
    tx,
    clinicId,
    pageRows.map((row) => row.patient_id),
  );
  const items = pageRows.map((row) => {
    const name = names.get(row.patient_id);
    if (name === undefined) throw new ApiError("unknown");
    return toPayment(row, name);
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: count!.total,
  };
}
