import { asDatabaseError, sql, type Tx } from "@eyadex/db";
import { pdfAdmissionQuota } from "./pg-pdf-admission-error.ts";

export type PdfAdmission =
  { status: "admitted" | "existing"; jobId: string } | { status: "saturated" };

/** Called after the source locks. The clinic lock serializes slot allocation across invoices. */
export async function admitPdf(
  tx: Tx,
  input: {
    clinicId: string;
    invoiceId: string;
    version: number;
    revision: string;
    jobId: string;
  },
): Promise<PdfAdmission> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pdf_admission:${input.clinicId}`},0))`,
  );
  const [existing] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM invoice_pdf_jobs WHERE clinic_id=${input.clinicId} AND invoice_id=${input.invoiceId}
      AND invoice_version=${input.version} AND render_revision=${input.revision}
      AND status IN ('queued','running','retry_wait','ready')
      AND (status <> 'ready' OR ready_until > clock_timestamp())`);
  if (existing) return { status: "existing", jobId: existing.id };
  // Retire stale running work too: its fence advances and its lease is removed. Evidence stays.
  await tx.execute(sql`UPDATE invoice_pdf_jobs SET status='superseded', clinic_slot=NULL,
    fence=fence+1, lease_token=NULL, lease_until=NULL, deadline_at=NULL, next_attempt_at=NULL,
    ready_until=NULL, cleanup_due_at=clock_timestamp(), error_code='superseded'
    WHERE clinic_id=${input.clinicId} AND invoice_id=${input.invoiceId}
      AND status IN ('queued','running','retry_wait','ready')`);
  const [slot] = await tx.execute<{ slot: number }>(sql`
    SELECT n AS slot FROM generate_series(1,10) n WHERE NOT EXISTS
      (SELECT 1 FROM invoice_pdf_jobs WHERE clinic_id=${input.clinicId} AND clinic_slot=n)
      ORDER BY n LIMIT 1`);
  if (!slot) return { status: "saturated" };
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`INSERT INTO invoice_pdf_jobs
        (clinic_id,id,invoice_id,invoice_version,render_revision,clinic_slot,created_at,updated_at)
        VALUES (${input.clinicId},${input.jobId},${input.invoiceId},${input.version},${input.revision},
          ${slot.slot},clock_timestamp(),clock_timestamp())`);
    });
    return { status: "admitted", jobId: input.jobId };
  } catch (error) {
    if (pdfAdmissionQuota(error)) return { status: "saturated" };
    throw asDatabaseError(error);
  }
}
