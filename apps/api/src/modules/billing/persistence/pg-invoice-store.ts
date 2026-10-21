import type { Invoice } from "@eyadex/contracts/finance";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { settlementView } from "../domain/settlement-view.ts";
import { readInvoiceMoney } from "./pg-patient-money.ts";

// SQL on invoices, invoice_lines (0060) and the clinic and branch columns finance owns. Every function
// runs inside the caller's withTenant(clinicId). Amounts travel as text both ways, so a bigint never
// passes through a JS number. The numbering has its own file (pg-invoice-numbering.ts).

/** What an issue reads of the clinic, and the clinic-timezone year of the issue instant (rule 8). */
export interface IssueClinicFacts {
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly taxRateBp: number;
  readonly year: number;
}

export async function issueClinicFacts(
  tx: Tx,
  clinicId: string,
  issuedAt: Date,
): Promise<IssueClinicFacts> {
  const [row] = await tx.execute<{
    currency: CurrencyCode;
    currency_exponent: number;
    tax_rate_bp: number;
    year: number;
  }>(
    sql`SELECT currency, currency_exponent, tax_rate_bp,
          extract(year FROM ${issuedAt.toISOString()}::timestamptz AT TIME ZONE timezone)::int AS year
        FROM clinics WHERE id = ${clinicId}`,
  );
  return {
    currency: row!.currency,
    currencyExponent: row!.currency_exponent,
    taxRateBp: row!.tax_rate_bp,
    year: row!.year,
  };
}

/** The clinic has issued no invoice yet: its first issue takes the finance lock (R2-3). */
export async function clinicHasInvoice(tx: Tx, clinicId: string): Promise<boolean> {
  const rows = await tx.execute<{ one: number }>(
    sql`SELECT 1 AS one FROM invoices WHERE clinic_id = ${clinicId} LIMIT 1`,
  );
  return rows.length > 0;
}

// The invoice numbering and the branch prefix live in their own file (the numbering has its own place
// in the lock order, ADR-0027 item 9b); they are re-exported here so the use cases keep one import.
export { branchPrefix, recordPrefix, takeNumber } from "./pg-invoice-numbering.ts";

/** One appointment or visit an invoice can bill. */
export interface InvoiceSource {
  readonly source: "appointment" | "visit";
  readonly sourceId: string;
}

/** The live (not void) invoice already billing any of these sources (one encounter), if any. */
export async function liveInvoiceOf(
  tx: Tx,
  clinicId: string,
  sources: readonly InvoiceSource[],
): Promise<string | null> {
  const any = sql.join(
    sources.map((s) => sql`(source = ${s.source} AND source_id = ${s.sourceId})`),
    sql` OR `,
  );
  const [row] = await tx.execute<{ id: string }>(
    sql`SELECT id FROM invoices WHERE clinic_id = ${clinicId} AND status <> 'void' AND (${any})`,
  );
  return row?.id ?? null;
}

/** An invoice row as the issue writes it. */
export interface NewInvoiceRow {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly year: number;
  readonly numberSeq: number;
  readonly number: string;
  readonly source: Invoice["source"];
  readonly sourceId: string | null;
  readonly issuedAt: Date;
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly subtotalMinor: string;
  readonly discountMinor: string;
  readonly taxRateBp: number;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly invoiceDiscount: Invoice["invoiceDiscount"];
  readonly createdBy: string;
}

export async function insertInvoice(tx: Tx, clinicId: string, row: NewInvoiceRow): Promise<void> {
  const at = row.issuedAt.toISOString();
  await tx.execute(
    sql`INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status,
          source, source_id, issued_at, currency, currency_exponent, subtotal_minor, discount_minor,
          tax_rate_bp, tax_minor, total_minor, invoice_discount, void_reason, voided_at, version,
          created_by, created_at, updated_at)
        VALUES (${clinicId}, ${row.id}, ${row.branchId}, ${row.patientId}, ${row.year},
          ${row.numberSeq}, ${row.number}, 'issued', ${row.source}, ${row.sourceId},
          ${at}::timestamptz, ${row.currency}, ${row.currencyExponent}, ${row.subtotalMinor}::bigint,
          ${row.discountMinor}::bigint, ${row.taxRateBp}, ${row.taxMinor}::bigint,
          ${row.totalMinor}::bigint, ${jsonOrNull(row.invoiceDiscount)}, NULL, NULL, 1,
          ${row.createdBy}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/** A line as stored: its position is its index; a service line carries the service's names. */
export type StoredLine = Invoice["lines"][number] & { readonly id: string };

export async function insertLines(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
  lines: readonly StoredLine[],
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  for (const line of lines) {
    await tx.execute(
      sql`INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, service_id,
            provider_id, description_ar, description_en, quantity, unit_price_minor, line_discount,
            line_total_minor, archived_at, created_at, updated_at)
          VALUES (${clinicId}, ${line.id}, ${invoiceId}, ${line.position}, ${line.kind},
            ${line.serviceId}, ${line.providerId}, ${line.descriptionAr}, ${line.descriptionEn},
            ${line.quantity}, ${line.unitPriceMinor}::bigint, ${jsonOrNull(line.discount)},
            ${line.lineTotalMinor}::bigint, NULL, ${at}::timestamptz, ${at}::timestamptz)`,
    );
  }
}

const jsonOrNull = (value: unknown) =>
  value === null ? sql`NULL` : sql`${JSON.stringify(value)}::jsonb`;

interface InvoiceRaw {
  id: string;
  number: string;
  status: Invoice["status"];
  source: Invoice["source"];
  source_id: string | null;
  branch_id: string;
  branch_name_ar: string;
  branch_name_en: string;
  patient_id: string;
  issued_at: string;
  currency: CurrencyCode;
  currency_exponent: number;
  subtotal_minor: string;
  discount_minor: string;
  tax_rate_bp: number;
  tax_minor: string;
  total_minor: string;
  invoice_discount: Invoice["invoiceDiscount"];
  void_reason: string | null;
  voided_at: string | null;
  version: number;
}

interface LineRaw {
  position: number;
  kind: "service" | "free";
  service_id: string | null;
  provider_id: string | null;
  description_ar: string;
  description_en: string;
  quantity: number;
  unit_price_minor: string;
  line_discount: Invoice["lines"][number]["discount"];
  line_total_minor: string;
}

/**
 * The invoice with its active lines in position order, as the API answers it.
 *
 * @returns the invoice, or null when it is no invoice of the clinic
 */
export async function readInvoice(tx: Tx, clinicId: string, id: string): Promise<Invoice | null> {
  const [row] = await tx.execute<InvoiceRaw>(
    sql`SELECT i.id, i.number, i.status, i.source, i.source_id, i.branch_id,
          b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, i.patient_id,
          to_char(i.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at,
          i.currency, i.currency_exponent, i.subtotal_minor::text, i.discount_minor::text,
          i.tax_rate_bp, i.tax_minor::text, i.total_minor::text, i.invoice_discount, i.void_reason,
          to_char(i.voided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS voided_at,
          i.version
        FROM invoices i JOIN branches b ON b.clinic_id = i.clinic_id AND b.id = i.branch_id
        WHERE i.clinic_id = ${clinicId} AND i.id = ${id}`,
  );
  if (row === undefined) return null;
  const lines = await tx.execute<LineRaw>(
    sql`SELECT position, kind, service_id, provider_id, description_ar, description_en, quantity,
          unit_price_minor::text, line_discount, line_total_minor::text
        FROM invoice_lines WHERE clinic_id = ${clinicId} AND invoice_id = ${id}
          AND archived_at IS NULL
        ORDER BY position`,
  );
  // The money on the invoice, so the answer carries the settlement the shared function derives
  // (spec §4.3, §4.6): a void invoice has no settlement.
  const money = await readInvoiceMoney(tx, clinicId, [id]);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    sourceId: row.source_id,
    branchId: row.branch_id,
    branchNameAr: row.branch_name_ar,
    branchNameEn: row.branch_name_en,
    patientId: row.patient_id,
    issuedAt: row.issued_at,
    currency: row.currency,
    currencyExponent: row.currency_exponent,
    subtotalMinor: row.subtotal_minor,
    discountMinor: row.discount_minor,
    taxRateBp: row.tax_rate_bp,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
    settlement: settlementView(money, {
      id: row.id,
      status: row.status,
      totalMinor: row.total_minor,
    }),
    invoiceDiscount: row.invoice_discount,
    lines: lines.map((l) => ({
      position: l.position,
      kind: l.kind,
      serviceId: l.service_id,
      providerId: l.provider_id,
      descriptionAr: l.description_ar,
      descriptionEn: l.description_en,
      quantity: l.quantity,
      unitPriceMinor: l.unit_price_minor,
      discount: l.line_discount,
      lineTotalMinor: l.line_total_minor,
    })),
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    version: row.version,
  };
}
