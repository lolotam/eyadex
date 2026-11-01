import { DatabaseError, sql, type Database } from "@eyadex/db";

import { canStartAttempt, isOneRunningCollision } from "../domain/export-failures.ts";
import type { ClaimDecision } from "../ports/export-store.ts";
import { asDate, attemptOf, lockExport, type LockedExport } from "./export-sql.ts";

const TERMINAL = new Set(["done", "expired", "purged"]);

/**
 * يلتقط التأجير أو يرجّع قرار الجدول. التأجير معاملة تطبيق مستقلة عن الـ dispatcher.
 *
 * @param db تجمع `eyadex_app`
 * @param input العيادة والتصدير والمالك
 * @returns القرار
 */
export async function decideExportClaim(
  db: Database,
  input: { readonly clinicId: string; readonly exportId: string; readonly leaseOwner: string },
): Promise<ClaimDecision> {
  try {
    return await db.withTenant(input.clinicId, (tx) => claimLocked(tx, input));
  } catch (error) {
    if (error instanceof DatabaseError && isOneRunningCollision(error))
      return memberBusy(db, input.clinicId);
    throw error;
  }
}

async function claimLocked(
  tx: Parameters<Parameters<Database["withTenant"]>[1]>[0],
  input: { readonly clinicId: string; readonly exportId: string; readonly leaseOwner: string },
): Promise<ClaimDecision> {
  const row = await lockExport(tx, input.clinicId, input.exportId);
  if (row === undefined) return { kind: "failed", error: "missing_export" };
  if (TERMINAL.has(row.status)) return { kind: "dispatched" };
  if (row.status === "failed") return { kind: "failed", error: row.error_code || "failed" };
  if (row.status === "running" && row.lease_live === true && row.lease_until !== null) {
    return { kind: "deferred", nextAttemptAt: asDate(row.lease_until) };
  }
  if (row.status === "queued" && row.waiting === true && row.next_attempt_at !== null) {
    return { kind: "deferred", nextAttemptAt: asDate(row.next_attempt_at) };
  }
  const attempt = attemptOf(row);
  if (!canStartAttempt(attempt)) return exhaust(tx, input, row, attempt);
  return lease(tx, input, row, attempt);
}

async function exhaust(
  tx: Parameters<Parameters<Database["withTenant"]>[1]>[0],
  input: { readonly clinicId: string; readonly exportId: string },
  row: LockedExport,
  attempt: number,
): Promise<ClaimDecision> {
  const updated = (await tx.execute(sql`UPDATE finance_report_exports
          SET status = 'failed', error_code = 'attempts_exhausted', lease_owner = NULL, lease_until = NULL
        WHERE clinic_id = ${input.clinicId} AND id = ${input.exportId}
          AND attempt = ${attempt} AND status = ${row.status}
        RETURNING id`)) as unknown as { id: string }[];
  if (updated.length !== 1) throw new Error("attempts_exhausted write missed");
  return { kind: "failed", error: "attempts_exhausted" };
}

async function lease(
  tx: Parameters<Parameters<Database["withTenant"]>[1]>[0],
  input: { readonly clinicId: string; readonly exportId: string; readonly leaseOwner: string },
  row: LockedExport,
  attempt: number,
): Promise<ClaimDecision> {
  const updated = (await tx.execute(sql`UPDATE finance_report_exports
          SET attempt = attempt + 1, lease_owner = ${input.leaseOwner},
              lease_until = clock_timestamp() + interval '60 seconds', status = 'running',
              started_at = COALESCE(started_at, clock_timestamp())
        WHERE clinic_id = ${input.clinicId} AND id = ${input.exportId}
          AND attempt = ${attempt} AND attempt < 5 AND status = ${row.status}
          AND (
            (status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp()))
            OR (status = 'running' AND (lease_until IS NULL OR lease_until <= clock_timestamp()))
          )
        RETURNING attempt, lease_until::text AS lease_until`)) as unknown as {
    attempt: number | string;
    lease_until: string;
  }[];
  const leased = updated[0];
  if (leased === undefined) throw new Error("lease write missed");
  return {
    kind: "leased",
    attempt: Number(leased.attempt),
    leaseUntil: asDate(leased.lease_until),
  };
}

async function memberBusy(db: Database, clinicId: string): Promise<ClaimDecision> {
  const nextAttemptAt = await db.withTenant(clinicId, async (tx) => {
    const found = (await tx.execute(
      sql`SELECT (clock_timestamp() + interval '30 seconds')::text AS next_attempt_at`,
    )) as unknown as { next_attempt_at: string }[];
    return asDate(found[0]!.next_attempt_at);
  });
  return { kind: "deferred", nextAttemptAt };
}
