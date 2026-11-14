import { sql, type Database, type Tx } from "@eyadex/db";

import {
  pdfFailureOutcome,
  type PdfFailureCode,
  type PdfFailureOutcome,
} from "../domain/pdf-job-failure.ts";
import type { PdfFenceAnswer, PdfJobFence } from "../ports/pdf-job-store.ts";

class PdfFenceMiss extends Error {}

interface FenceRow {
  readonly status: string;
  readonly attempt: number | string;
  readonly retry_count: number | string;
  readonly fence: string;
  readonly lease_token: string | null;
  readonly lease_until: string | null;
  readonly deadline_at: string | null;
  readonly next_attempt_at: string | null;
  readonly clinic_slot: number | null;
  readonly cleanup_due_at: string | null;
  readonly error_code: string | null;
}

const FENCE_COLUMNS = sql`status,attempt,retry_count,fence,lease_token,lease_until::text,
  deadline_at::text,next_attempt_at::text,clinic_slot,cleanup_due_at::text,error_code`;

export async function heartbeatPdfJob(db: Database, fence: PdfJobFence): Promise<PdfFenceAnswer> {
  try {
    return await db.withTenant(fence.clinicId, async (tx) => {
      const current = await lockLiveRow(tx, fence);
      const updated = await tx.execute<{ id: string }>(sql`UPDATE invoice_pdf_jobs
        SET lease_until=LEAST(clock_timestamp()+interval '60 seconds',deadline_at)
        WHERE clinic_id=${fence.clinicId} AND id=${fence.jobId} AND status='running'
          AND attempt=${fence.attempt} AND fence=${String(fence.fence)}
          AND lease_token=${fence.leaseToken}::uuid AND lease_until=${current.lease_until}
          AND deadline_at=${current.deadline_at}
          AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp()
        RETURNING id`);
      if (updated.length !== 1) throw new PdfFenceMiss();
      return { kind: "applied" };
    });
  } catch (error) {
    if (!(error instanceof PdfFenceMiss)) throw error;
    return rereadAfterMiss(db, fence);
  }
}

export async function failPdfJob(
  db: Database,
  fence: PdfJobFence,
  code: PdfFailureCode,
): Promise<PdfFenceAnswer> {
  try {
    return await db.withTenant(fence.clinicId, async (tx) => {
      const current = await lockLiveRow(tx, fence);
      const outcome = pdfFailureOutcome(code, {
        attempt: Number(current.attempt),
        retryCount: Number(current.retry_count),
      });
      const nextAttempt =
        outcome.delaySeconds === null
          ? sql`NULL`
          : sql`clock_timestamp()+(${outcome.delaySeconds}*interval '1 second')`;
      const slot = outcome.status === "retry_wait" ? current.clinic_slot : null;
      const cleanup = outcome.status === "retry_wait" ? sql`NULL` : sql`clock_timestamp()`;
      const updated = await tx.execute<{ id: string }>(sql`UPDATE invoice_pdf_jobs
        SET status=${outcome.status},retry_count=${outcome.retryCount},lease_token=NULL,
          lease_until=NULL,deadline_at=NULL,next_attempt_at=${nextAttempt},clinic_slot=${slot},
          cleanup_due_at=${cleanup},error_code=${code}
        WHERE clinic_id=${fence.clinicId} AND id=${fence.jobId} AND status='running'
          AND attempt=${fence.attempt} AND fence=${String(fence.fence)}
          AND lease_token=${fence.leaseToken}::uuid AND retry_count=${current.retry_count}
          AND lease_until=${current.lease_until} AND deadline_at=${current.deadline_at}
          AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp()
        RETURNING id`);
      if (updated.length !== 1) throw new PdfFenceMiss();
      return { kind: "applied" };
    });
  } catch (error) {
    if (!(error instanceof PdfFenceMiss)) throw error;
    return rereadAfterMiss(db, fence, code);
  }
}

async function lockLiveRow(tx: Tx, fence: PdfJobFence): Promise<FenceRow> {
  const [current] = await tx.execute<FenceRow>(sql`SELECT ${FENCE_COLUMNS} FROM invoice_pdf_jobs
    WHERE clinic_id=${fence.clinicId} AND id=${fence.jobId} FOR UPDATE`);
  if (!current || !sameFence(current, fence)) throw new PdfFenceMiss();
  const [fresh] = await tx.execute<{ live: boolean }>(sql`SELECT (status='running'
    AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp()) AS live
    FROM invoice_pdf_jobs WHERE clinic_id=${fence.clinicId} AND id=${fence.jobId}`);
  if (!fresh?.live) throw new PdfFenceMiss();
  return current;
}

async function rereadAfterMiss(
  db: Database,
  fence: PdfJobFence,
  code?: PdfFailureCode,
): Promise<PdfFenceAnswer> {
  return db.withTenant(fence.clinicId, async (tx) => {
    const [row] = await tx.execute<FenceRow>(sql`SELECT ${FENCE_COLUMNS} FROM invoice_pdf_jobs
      WHERE clinic_id=${fence.clinicId} AND id=${fence.jobId}`);
    if (!row || code === undefined || !sameAttemptFence(row, fence) || row.error_code !== code) {
      return { kind: "lost_lease" };
    }
    const retryCount = Number(row.retry_count);
    const priorCounts = [...new Set([retryCount, retryCount - 1])].filter(
      (count) => count >= 0 && count <= 2,
    );
    const own = priorCounts.some((priorCount) => {
      const outcome = pdfFailureOutcome(code, {
        attempt: Number(row.attempt),
        retryCount: priorCount,
      });
      return matchesOutcome(row, outcome);
    });
    return { kind: own ? "own_success" : "lost_lease" };
  });
}

function sameFence(row: FenceRow, fence: PdfJobFence): boolean {
  return sameAttemptFence(row, fence) && row.lease_token === fence.leaseToken;
}

function sameAttemptFence(row: FenceRow, fence: PdfJobFence): boolean {
  return Number(row.attempt) === fence.attempt && BigInt(row.fence) === fence.fence;
}

function matchesOutcome(row: FenceRow, outcome: PdfFailureOutcome): boolean {
  if (
    row.status !== outcome.status ||
    Number(row.retry_count) !== outcome.retryCount ||
    row.lease_token !== null ||
    row.lease_until !== null ||
    row.deadline_at !== null
  ) {
    return false;
  }
  if (outcome.status === "retry_wait") {
    return row.next_attempt_at !== null && row.clinic_slot !== null && row.cleanup_due_at === null;
  }
  return row.next_attempt_at === null && row.clinic_slot === null && row.cleanup_due_at !== null;
}
