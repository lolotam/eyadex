import type { InvoiceListQuery, invoiceListItemSchema } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { ApiError } from "../../../shared/errors.ts";
import type { InvoiceSource } from "../persistence/pg-invoice-store.ts";

type InvoiceListItem = z.infer<typeof invoiceListItemSchema>;

// The opaque cursor is the last id without its dashes: ids are UUID v7, so id order is issue order.
const toCursor = (id: string) => id.replaceAll("-", "");
const fromCursor = (cursor: string): string | null => {
  if (!/^[0-9a-f]{32}$/.test(cursor)) return null;
  const at = [8, 12, 16, 20];
  return [0, ...at].map((start, i) => cursor.slice(start, at[i])).join("-");
};

const iso = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function filters(
  clinicId: string,
  query: InvoiceListQuery,
  reach: SQL,
  encounter: readonly InvoiceSource[],
): SQL[] {
  const where = [sql`i.clinic_id = ${clinicId}`, reach];
  if (query.branchId !== undefined) where.push(sql`i.branch_id = ${query.branchId}`);
  if (query.patientId !== undefined) where.push(sql`i.patient_id = ${query.patientId}`);
  if (query.status !== undefined) where.push(sql`i.status = ${query.status}`);
  if (encounter.length > 0) {
    const sources = [{ source: query.source!, sourceId: query.sourceId! }, ...encounter];
    where.push(
      sql`(${sql.join(
        sources.map((s) => sql`(i.source = ${s.source} AND i.source_id = ${s.sourceId}::uuid)`),
        sql` OR `,
      )})`,
    );
  } else {
    if (query.source !== undefined) where.push(sql`i.source = ${query.source}`);
    if (query.sourceId !== undefined) where.push(sql`i.source_id = ${query.sourceId}`);
  }
  if (query.number !== undefined) {
    where.push(sql`i.number ILIKE ${`%${escapeLike(query.number)}%`}`);
  }
  // The days are the clinic's own (spec §3.3), read in its timezone.
  const day = sql`(i.issued_at AT TIME ZONE c.timezone)::date`;
  if (query.from !== undefined) where.push(sql`${day} >= ${query.from}::date`);
  if (query.to !== undefined) where.push(sql`${day} <= ${query.to}::date`);
  return where;
}

interface Row {
  id: string;
  number: string;
  status: InvoiceListItem["status"];
  source: InvoiceListItem["source"];
  source_id: string | null;
  branch_id: string;
  branch_name_ar: string;
  branch_name_en: string;
  patient_id: string;
  issued_at: string;
  currency: InvoiceListItem["currency"];
  currency_exponent: number;
  subtotal_minor: string;
  discount_minor: string;
  tax_rate_bp: number;
  tax_minor: string;
  total_minor: string;
  invoice_discount: InvoiceListItem["invoiceDiscount"];
  void_reason: string | null;
  voided_at: string | null;
  version: number;
}

const toItem = (r: Row): InvoiceListItem => ({
  id: r.id,
  number: r.number,
  status: r.status,
  source: r.source,
  sourceId: r.source_id,
  branchId: r.branch_id,
  branchNameAr: r.branch_name_ar,
  branchNameEn: r.branch_name_en,
  patientId: r.patient_id,
  issuedAt: r.issued_at,
  currency: r.currency,
  currencyExponent: r.currency_exponent,
  subtotalMinor: r.subtotal_minor,
  discountMinor: r.discount_minor,
  taxRateBp: r.tax_rate_bp,
  taxMinor: r.tax_minor,
  totalMinor: r.total_minor,
  invoiceDiscount: r.invoice_discount,
  voidReason: r.void_reason,
  voidedAt: r.voided_at,
  version: r.version,
});

/**
 * `GET /v1/invoices`: newest first, a page and the total that matches, inside the caller's reach.
 *
 * @param reach the caller's view condition on the alias `i`
 * @returns the page, the next cursor and the total
 */
export async function listInvoices(
  tx: Tx,
  clinicId: string,
  query: InvoiceListQuery,
  reach: SQL,
  encounter: readonly InvoiceSource[] = [],
): Promise<{ items: InvoiceListItem[]; nextCursor: string | null; total: number }> {
  const where = filters(clinicId, query, reach, encounter);
  const from = sql`FROM invoices i JOIN clinics c ON c.id = i.clinic_id
                   JOIN branches b ON b.clinic_id = i.clinic_id AND b.id = i.branch_id`;
  const [count] = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total ${from} WHERE ${sql.join(where, sql` AND `)}`,
  );
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  // A cursor this list never made is refused, like every other list, instead of restarting at page one.
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  const page = after === null ? where : [...where, sql`i.id < ${after}::uuid`];
  const rows = await tx.execute<Row>(
    sql`SELECT i.id, i.number, i.status, i.source, i.source_id, i.branch_id,
          b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, i.patient_id,
          ${iso(sql`i.issued_at`)} AS issued_at, i.currency, i.currency_exponent,
          i.subtotal_minor::text AS subtotal_minor, i.discount_minor::text AS discount_minor,
          i.tax_rate_bp, i.tax_minor::text AS tax_minor, i.total_minor::text AS total_minor,
          i.invoice_discount, i.void_reason, ${iso(sql`i.voided_at`)} AS voided_at, i.version
        ${from} WHERE ${sql.join(page, sql` AND `)}
        ORDER BY i.id DESC LIMIT ${query.limit + 1}`,
  );
  const items = rows.slice(0, query.limit).map(toItem);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: count!.total,
  };
}
