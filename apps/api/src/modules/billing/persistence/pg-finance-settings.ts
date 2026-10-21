import type { FinanceSettings, InvoicePrefixItem } from "@eyadex/contracts/finance";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { paymentMethodSettings } from "../domain/payment-rules.ts";
import { paymentMethodRows } from "./pg-payment-writes.ts";

// SQL on the clinic columns finance owns (0060: commercial_reg_no, logo_blob_key) and the branches'
// invoice prefix. Every function runs inside the caller's withTenant(clinicId).

export async function readFinanceSettings(tx: Tx, clinicId: string): Promise<FinanceSettings> {
  const [row] = await tx.execute<{
    currency: CurrencyCode;
    currency_exponent: number;
    tax_rate_bp: number;
    commercial_reg_no: string | null;
    logo_blob_key: string | null;
  }>(
    sql`SELECT currency, currency_exponent, tax_rate_bp, commercial_reg_no, logo_blob_key
        FROM clinics WHERE id = ${clinicId}`,
  );
  return {
    currency: row!.currency,
    currencyExponent: row!.currency_exponent,
    taxRateBp: row!.tax_rate_bp,
    commercialRegNo: row!.commercial_reg_no,
    hasLogo: row!.logo_blob_key !== null,
    // FIN-11: the four methods in the fixed order; a method with no row is still on.
    paymentMethods: paymentMethodSettings(await paymentMethodRows(tx, clinicId)),
  };
}

export async function setCommercialRegNo(
  tx: Tx,
  clinicId: string,
  value: string | null,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE clinics SET commercial_reg_no = ${value}, updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${clinicId}`,
  );
}

export async function logoKey(tx: Tx, clinicId: string): Promise<string | null> {
  const [row] = await tx.execute<{ logo_blob_key: string | null }>(
    sql`SELECT logo_blob_key FROM clinics WHERE id = ${clinicId}`,
  );
  return row?.logo_blob_key ?? null;
}

export async function setLogoKey(tx: Tx, clinicId: string, key: string, now: Date): Promise<void> {
  await tx.execute(
    sql`UPDATE clinics SET logo_blob_key = ${key}, updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${clinicId}`,
  );
}

/**
 * The clinic row locked FOR UPDATE (ADR-0027 item 11): a clinic settings writer takes it and nothing
 * after it, so two changes of the same setting run one after the other and each one audits the result
 * of the other.
 *
 * @param tx the transaction inside the caller's withTenant(clinicId)
 * @param clinicId the clinic
 */
export async function lockClinicRow(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM clinics WHERE id = ${clinicId} FOR UPDATE`);
}

// A branch is locked once it has issued an invoice (spec §8 rule 9); the used prefix records it too.
const LOCKED = sql`(EXISTS (SELECT 1 FROM invoices i WHERE i.clinic_id = b.clinic_id
  AND i.branch_id = b.id) OR EXISTS (SELECT 1 FROM used_invoice_prefixes u
  WHERE u.clinic_id = b.clinic_id AND u.branch_id = b.id))`;

/**
 * Every branch's prefix and whether it is locked, in branch creation order.
 *
 * @returns one item per branch of the clinic
 */
export async function listPrefixes(tx: Tx, clinicId: string): Promise<InvoicePrefixItem[]> {
  const rows = await tx.execute<{ id: string; invoice_prefix: string | null; locked: boolean }>(
    sql`SELECT b.id, b.invoice_prefix, ${LOCKED} AS locked FROM branches b
        WHERE b.clinic_id = ${clinicId} ORDER BY b.id`,
  );
  return rows.map((r) => ({ branchId: r.id, invoicePrefix: r.invoice_prefix, locked: r.locked }));
}

/**
 * The branch row locked FOR UPDATE, so a prefix change and an issue in the branch never interleave.
 * Whether the prefix is locked is read by a second statement, after the lock: a first issue holds the
 * row FOR SHARE without changing it, so the locking statement would keep the snapshot it took before
 * that issue committed and miss its invoice (PR #78 review).
 *
 * @returns the branch's prefix item, or null when it is no branch of the clinic
 */
export async function lockBranchPrefix(
  tx: Tx,
  clinicId: string,
  branchId: string,
): Promise<InvoicePrefixItem | null> {
  const [row] = await tx.execute<{ invoice_prefix: string | null }>(
    sql`SELECT invoice_prefix FROM branches
        WHERE clinic_id = ${clinicId} AND id = ${branchId} FOR UPDATE`,
  );
  if (row === undefined) return null;
  const [state] = await tx.execute<{ locked: boolean }>(
    sql`SELECT ${LOCKED} AS locked FROM branches b
        WHERE b.clinic_id = ${clinicId} AND b.id = ${branchId}`,
  );
  return { branchId, invoicePrefix: row.invoice_prefix, locked: state!.locked };
}

/** Another branch of the clinic holds or once used this prefix. */
export async function prefixTaken(
  tx: Tx,
  clinicId: string,
  branchId: string,
  prefix: string,
): Promise<boolean> {
  const rows = await tx.execute<{ one: number }>(
    sql`SELECT 1 AS one FROM branches WHERE clinic_id = ${clinicId} AND invoice_prefix = ${prefix}
          AND id <> ${branchId}
        UNION ALL
        SELECT 1 FROM used_invoice_prefixes WHERE clinic_id = ${clinicId} AND prefix = ${prefix}
          AND branch_id <> ${branchId}`,
  );
  return rows.length > 0;
}

export async function setBranchPrefix(
  tx: Tx,
  clinicId: string,
  branchId: string,
  prefix: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE branches SET invoice_prefix = ${prefix}, updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${branchId}`,
  );
}
