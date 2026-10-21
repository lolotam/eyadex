import type { CashMovement } from "@eyadex/contracts/finance";
import { PAYMENT_METHODS, type PaymentMethod } from "@eyadex/contracts/finance-payments";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { DrawerState } from "../domain/cash-closing-rules.ts";

// SQL on a branch's cash drawer (0064 `branch_cash_drawers`) and the cash movements it numbered. Every
// function runs inside the caller's withTenant(clinicId). Amounts and cash numbers travel as text, so a
// bigint never passes through a JS number.

/** The clinic's currency and timezone: a closing names no invoice, so it reads them from the clinic. */
export interface ClinicMoneyFacts {
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly timezone: string;
}

/**
 * The clinic's currency, its exponent and its timezone (R1-8: the business day is the clinic's own day).
 *
 * @returns the facts; the clinic exists, since the caller is inside its tenant
 */
export async function clinicMoneyFacts(tx: Tx, clinicId: string): Promise<ClinicMoneyFacts> {
  const [row] = await tx.execute<{
    currency: CurrencyCode;
    currency_exponent: number;
    timezone: string;
  }>(sql`SELECT currency, currency_exponent, timezone FROM clinics WHERE id = ${clinicId}`);
  return {
    currency: row!.currency,
    currencyExponent: row!.currency_exponent,
    timezone: row!.timezone,
  };
}

/**
 * The branch row `FOR SHARE` (ADR-0027 item 9): a closing holds its branch before its drawer, as a cash
 * payment does, so the two never wait on each other in a cycle.
 *
 * @returns whether the branch is a branch of the clinic
 */
export async function shareBranch(tx: Tx, clinicId: string, branchId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM branches WHERE clinic_id = ${clinicId} AND id = ${branchId} FOR SHARE`,
  );
  return rows.length === 1;
}

/**
 * Whether the branch is a branch of the clinic, read without a lock (the preview stores nothing).
 *
 * @returns whether it is
 */
export async function branchExists(tx: Tx, clinicId: string, branchId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM branches WHERE clinic_id = ${clinicId} AND id = ${branchId}`,
  );
  return rows.length === 1;
}

interface DrawerRaw {
  last_cash_seq: string;
  last_closed_seq: string;
  last_closing_id: string | null;
}

const toDrawer = (row: DrawerRaw): DrawerState => ({
  lastCashSeq: BigInt(row.last_cash_seq),
  lastClosedSeq: BigInt(row.last_closed_seq),
  lastClosingId: row.last_closing_id,
});

const DRAWER_COLUMNS = sql`last_cash_seq::text AS last_cash_seq, last_closed_seq::text AS last_closed_seq,
  last_closing_id`;

/**
 * The branch's drawer as it stands, without a lock: what the preview shows (spec §4.6).
 *
 * @returns the drawer, or null when the branch never had a cash movement or a closing
 */
export async function readDrawer(
  tx: Tx,
  clinicId: string,
  branchId: string,
): Promise<DrawerState | null> {
  const [row] = await tx.execute<DrawerRaw>(
    sql`SELECT ${DRAWER_COLUMNS} FROM branch_cash_drawers
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId}`,
  );
  return row === undefined ? null : toDrawer(row);
}

/**
 * The branch's drawer `FOR UPDATE` (ADR-0027 item 9a), created first if missing: a closing holds it, so no
 * cash movement takes a number while the closing decides its period (spec §4.4).
 *
 * @returns the drawer under the lock
 */
export async function lockDrawer(
  tx: Tx,
  ids: { newId(): string },
  clinicId: string,
  branchId: string,
  now: Date,
): Promise<DrawerState> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq,
          last_closing_id, created_at, updated_at)
        VALUES (${clinicId}, ${ids.newId()}, ${branchId}, 0, 0, NULL, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT (clinic_id, branch_id) DO NOTHING`,
  );
  const [row] = await tx.execute<DrawerRaw>(
    sql`SELECT ${DRAWER_COLUMNS} FROM branch_cash_drawers
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} FOR UPDATE`,
  );
  return toDrawer(row!);
}

/**
 * Moves the drawer's closed position to the closing just written (spec §4.4): the next closing starts
 * where this one ended. The closing row is written first, because the drawer references it.
 */
export async function advanceDrawer(
  tx: Tx,
  clinicId: string,
  branchId: string,
  closing: { readonly id: string; readonly toCashSeq: bigint },
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE branch_cash_drawers SET last_closed_seq = ${String(closing.toCashSeq)}::bigint,
          last_closing_id = ${closing.id}, updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId}`,
  );
}

interface MovementRaw {
  kind: "payment" | "refund";
  id: string;
  number: string;
  cash_seq: string;
  amount_minor: string;
  at_time: string;
}

/**
 * The branch's cash movements numbered in `(fromSeq, throughSeq]`, by cash number: the receipts paid in
 * cash and the refunds paid out in cash. No patient is named (spec §4.6).
 *
 * @returns the movements, by cash number
 */
export async function drawerMovements(
  tx: Tx,
  clinicId: string,
  branchId: string,
  fromSeq: bigint,
  throughSeq: bigint,
): Promise<CashMovement[]> {
  const from = String(fromSeq);
  const through = String(throughSeq);
  const rows = await tx.execute<MovementRaw>(
    sql`SELECT 'payment' AS kind, p.id, p.receipt_number AS number, p.cash_seq::text AS cash_seq,
          p.amount_minor::text AS amount_minor,
          to_char(p.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_time
        FROM payments p
        WHERE p.clinic_id = ${clinicId} AND p.branch_id = ${branchId}
          AND p.cash_seq > ${from}::bigint AND p.cash_seq <= ${through}::bigint
        UNION ALL
        SELECT 'refund', r.id, r.refund_number, r.cash_seq::text, r.amount_minor::text,
          to_char(r.refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        FROM refunds r
        WHERE r.clinic_id = ${clinicId} AND r.branch_id = ${branchId}
          AND r.cash_seq > ${from}::bigint AND r.cash_seq <= ${through}::bigint`,
  );
  // The cash numbers come back as text, whose order is not their numeric order: sorted as bigints here.
  return rows
    .map((row) =>
      row.kind === "payment"
        ? {
            kind: "payment" as const,
            paymentId: row.id,
            receiptNumber: row.number,
            cashSeq: row.cash_seq,
            amountMinor: row.amount_minor,
            at: row.at_time,
          }
        : {
            kind: "refund" as const,
            refundId: row.id,
            refundNumber: row.number,
            cashSeq: row.cash_seq,
            amountMinor: row.amount_minor,
            at: row.at_time,
          },
    )
    .sort((left, right) => (BigInt(left.cashSeq) < BigInt(right.cashSeq) ? -1 : 1));
}

/** Money in and out for one method on one business day, as text. */
export interface MethodTotal {
  readonly method: PaymentMethod;
  readonly inMinor: string;
  readonly outMinor: string;
}

/**
 * Every method's money in and out of the branch on one business day, in the fixed method order (R3-8:
 * information only; a non-cash movement committing at this moment may be missing).
 *
 * @returns the four methods, each with its totals ("0" when none)
 */
export async function methodTotals(
  tx: Tx,
  clinicId: string,
  branchId: string,
  businessDate: string,
): Promise<MethodTotal[]> {
  const rows = await tx.execute<{ method: PaymentMethod; in_minor: string; out_minor: string }>(
    sql`SELECT m.method, coalesce(sum(m.in_minor), 0)::text AS in_minor,
          coalesce(sum(m.out_minor), 0)::text AS out_minor
        FROM (
          SELECT p.method, p.amount_minor AS in_minor, 0::bigint AS out_minor FROM payments p
          WHERE p.clinic_id = ${clinicId} AND p.branch_id = ${branchId}
            AND p.business_date = ${businessDate}::date
          UNION ALL
          SELECT r.method, 0::bigint, r.amount_minor FROM refunds r
          WHERE r.clinic_id = ${clinicId} AND r.branch_id = ${branchId}
            AND r.business_date = ${businessDate}::date
        ) m
        GROUP BY m.method`,
  );
  return PAYMENT_METHODS.map((method) => {
    const row = rows.find((total) => total.method === method);
    return { method, inMinor: row?.in_minor ?? "0", outMinor: row?.out_minor ?? "0" };
  });
}
