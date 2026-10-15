import type { Invoice } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL for the edit and the void (spec §8 rules 8 and 10). Every function runs inside the caller's
// withTenant(clinicId), after the patient lock.

/** The facts the edit and the void check under the row lock. */
export interface LockedInvoice {
  readonly patientId: string;
  readonly branchId: string;
  readonly status: Invoice["status"];
  readonly version: number;
  readonly taxRateBp: number;
}

/** Where the invoice belongs, read before any lock to find the patient to lock first. */
export async function invoiceOwner(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<{ patientId: string; branchId: string } | null> {
  const [row] = await tx.execute<{ patient_id: string; branch_id: string }>(
    sql`SELECT patient_id, branch_id FROM invoices WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
  return row === undefined ? null : { patientId: row.patient_id, branchId: row.branch_id };
}

/**
 * The invoice row locked FOR SHARE for a send (spec §8 rule 15): a void running now finishes first, so a
 * void invoice is never queued.
 */
export async function shareInvoice(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<{ patientId: string; branchId: string; status: Invoice["status"] } | null> {
  const [row] = await tx.execute<{
    patient_id: string;
    branch_id: string;
    status: Invoice["status"];
  }>(
    sql`SELECT patient_id, branch_id, status FROM invoices
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR SHARE`,
  );
  return row === undefined
    ? null
    : { patientId: row.patient_id, branchId: row.branch_id, status: row.status };
}

/** The invoice row locked FOR UPDATE; its status and version are judged only after this. */
export async function lockInvoice(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<LockedInvoice | null> {
  const [row] = await tx.execute<{
    patient_id: string;
    branch_id: string;
    status: Invoice["status"];
    version: number;
    tax_rate_bp: number;
  }>(
    sql`SELECT patient_id, branch_id, status, version, tax_rate_bp FROM invoices
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE`,
  );
  return row === undefined
    ? null
    : {
        patientId: row.patient_id,
        branchId: row.branch_id,
        status: row.status,
        version: row.version,
        taxRateBp: row.tax_rate_bp,
      };
}

/** Archives the active lines; an edit writes the new ones beside them (spec §3.2, never deleted). */
export async function archiveLines(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE invoice_lines SET archived_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND invoice_id = ${invoiceId} AND archived_at IS NULL`,
  );
}

/** The recomputed totals and invoice discount of an edit, one version up. */
export async function saveEditedTotals(
  tx: Tx,
  clinicId: string,
  id: string,
  totals: {
    readonly subtotalMinor: string;
    readonly discountMinor: string;
    readonly taxMinor: string;
    readonly totalMinor: string;
    readonly invoiceDiscount: Invoice["invoiceDiscount"];
  },
  now: Date,
): Promise<void> {
  const discount =
    totals.invoiceDiscount === null
      ? sql`NULL`
      : sql`${JSON.stringify(totals.invoiceDiscount)}::jsonb`;
  await tx.execute(
    sql`UPDATE invoices SET subtotal_minor = ${totals.subtotalMinor}::bigint,
          discount_minor = ${totals.discountMinor}::bigint, tax_minor = ${totals.taxMinor}::bigint,
          total_minor = ${totals.totalMinor}::bigint, invoice_discount = ${discount},
          version = version + 1, updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/** Voids the invoice: its number and lines stay; one version up (FIN-8). */
export async function voidInvoiceRow(
  tx: Tx,
  clinicId: string,
  id: string,
  reason: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE invoices SET status = 'void', void_reason = ${reason}, voided_at = ${at}::timestamptz,
          version = version + 1, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/** Revokes the invoice's live patient links (R2-7): a void invoice is never shown through one. */
export async function revokeLinks(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE invoice_links SET revoked_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND invoice_id = ${invoiceId} AND revoked_at IS NULL`,
  );
}
