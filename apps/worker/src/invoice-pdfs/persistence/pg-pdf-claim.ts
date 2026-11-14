import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";

import { pdfFailureOutcome } from "../domain/pdf-job-failure.ts";
import type { LeasedPdfJob, PdfClaim } from "../ports/pdf-job-store.ts";

class PdfClaimMiss extends Error {}

class PdfRecoveryMiss extends Error {
  constructor() {
    super("PDF recovery update missed");
    this.name = "PdfRecoveryMiss";
  }
}

interface JobRow {
  readonly id: string;
  readonly invoice_id: string;
  readonly invoice_version: number | string;
  readonly render_revision: string;
  readonly status: string;
  readonly attempt: number | string;
  readonly retry_count: number | string;
  readonly fence: string;
  readonly lease_token: string | null;
  readonly lease_until: string | null;
  readonly deadline_at: string | null;
  readonly next_attempt_at: string | null;
  readonly clinic_slot: number | null;
}

interface LeaseRow extends JobRow {
  readonly lease_until: string;
  readonly deadline_at: string;
}

const JOB_COLUMNS = sql`id,invoice_id,invoice_version,render_revision,status,attempt,retry_count,fence,
  lease_token,lease_until::text,deadline_at::text,next_attempt_at::text,clinic_slot`;

export async function claimPdfJob(
  db: Database,
  ids: IdGenerator,
  clinicId: string,
): Promise<PdfClaim> {
  try {
    return await db.withTenant(clinicId, async (tx) => {
      await recoverExpiredJobs(tx, clinicId);
      const [selected] = await tx.execute<JobRow>(sql`SELECT ${JOB_COLUMNS} FROM invoice_pdf_jobs
        WHERE clinic_id=${clinicId} AND (status='queued'
          OR (status='retry_wait' AND next_attempt_at<=clock_timestamp()))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!selected) return { kind: "empty" };
      const [current] = await tx.execute<JobRow>(sql`SELECT ${JOB_COLUMNS} FROM invoice_pdf_jobs
        WHERE clinic_id=${clinicId} AND id=${selected.id}`);
      if (!current) throw new PdfClaimMiss();
      const [fresh] = await tx.execute<{ due: boolean }>(sql`SELECT (status='queued'
        OR (status='retry_wait' AND next_attempt_at<=clock_timestamp())) AS due
        FROM invoice_pdf_jobs WHERE clinic_id=${clinicId} AND id=${selected.id}`);
      if (!fresh?.due) throw new PdfClaimMiss();
      const leaseToken = ids.newId();
      const updated = await tx.execute<LeaseRow>(sql`
        WITH tick AS (SELECT clock_timestamp()+interval '60 seconds' AS until)
        UPDATE invoice_pdf_jobs AS j SET status='running',attempt=j.attempt+1,fence=j.fence+1,
          lease_token=${leaseToken}::uuid,lease_until=tick.until,deadline_at=tick.until,
          next_attempt_at=NULL,error_code=NULL
        FROM tick
        WHERE j.clinic_id=${clinicId} AND j.id=${current.id} AND j.status=${current.status}
          AND j.attempt=${current.attempt} AND j.fence=${current.fence}
          AND (j.status='queued' OR (j.status='retry_wait' AND j.next_attempt_at<=clock_timestamp()))
        RETURNING id,invoice_id,invoice_version,render_revision,status,attempt,retry_count,fence,
          lease_token,clinic_slot,lease_until::text,deadline_at::text`);
      const leased = updated[0];
      if (!leased) throw new PdfClaimMiss();
      return { kind: "claimed", job: toLease(clinicId, leased) };
    });
  } catch (error) {
    if (error instanceof PdfClaimMiss) return { kind: "empty" };
    throw error;
  }
}

async function recoverExpiredJobs(tx: Tx, clinicId: string): Promise<void> {
  const expired = await tx.execute<JobRow>(sql`SELECT ${JOB_COLUMNS} FROM invoice_pdf_jobs
    WHERE clinic_id=${clinicId} AND status='running' AND lease_until<=clock_timestamp()
    ORDER BY created_at,id LIMIT 20 FOR UPDATE SKIP LOCKED`);
  for (const candidate of expired) {
    const [current] = await tx.execute<JobRow>(sql`SELECT ${JOB_COLUMNS} FROM invoice_pdf_jobs
      WHERE clinic_id=${clinicId} AND id=${candidate.id}`);
    if (!current) throw new PdfRecoveryMiss();
    const [fresh] = await tx.execute<{ expired: boolean }>(sql`SELECT (status='running'
      AND lease_until<=clock_timestamp()) AS expired FROM invoice_pdf_jobs
      WHERE clinic_id=${clinicId} AND id=${candidate.id}`);
    if (!fresh?.expired) throw new PdfRecoveryMiss();
    const outcome = pdfFailureOutcome("lease_expired", {
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
      SET status=${outcome.status},retry_count=${outcome.retryCount},lease_token=NULL,lease_until=NULL,
        deadline_at=NULL,next_attempt_at=${nextAttempt},clinic_slot=${slot},cleanup_due_at=${cleanup},
        error_code='lease_expired'
      WHERE clinic_id=${clinicId} AND id=${current.id} AND status='running'
        AND attempt=${current.attempt} AND fence=${current.fence} AND lease_token=${current.lease_token}
        AND lease_until<=clock_timestamp()
      RETURNING id`);
    if (updated.length !== 1) throw new PdfRecoveryMiss();
  }
}

function toLease(clinicId: string, row: LeaseRow): LeasedPdfJob {
  return {
    clinicId,
    jobId: row.id,
    invoiceId: row.invoice_id,
    invoiceVersion: Number(row.invoice_version),
    renderRevision: row.render_revision,
    attempt: Number(row.attempt),
    fence: BigInt(row.fence),
    leaseToken: row.lease_token!,
    leaseUntil: new Date(row.lease_until),
    deadlineAt: new Date(row.deadline_at),
  };
}
