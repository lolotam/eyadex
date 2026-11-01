import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";
import type { ExportBuildSink, ExportReportReader } from "../ports/export-builder.ts";
import type { ExportFence, PreparedExportJob } from "../ports/export-store.ts";
import { ExportReadRefused } from "../domain/export-read-refused.ts";
import { exportReportQuery } from "./export-report-queries.ts";
import { cells, withNames } from "./export-report-cells.ts";
import { prepareExportInTransaction } from "./pg-export-prepare.ts";
import {
  completeExportPatients,
  ownExportPatientsReachable,
  recordExportPatients,
} from "./pg-export-patients.ts";

type Raw = Record<string, unknown>;

/** One financial SELECT snapshot, bounded transfer/names, and current access before/after each page. */
export class PgExportReports implements ExportReportReader {
  constructor(
    private readonly db: Database,
    private readonly clock: { now(): Date },
    private readonly ids: IdGenerator,
  ) {}

  /** @inheritdoc */
  async read(
    fence: ExportFence,
    _preflight: PreparedExportJob,
    signal: AbortSignal,
    sink: ExportBuildSink,
  ) {
    const startedAt = this.clock.now();
    return this.db.withTenant(fence.clinicId, async (tx) => {
      const job = await currentJob(tx, fence, signal);
      await sink.start(job);
      const clinic = await tx.execute<{ today: string }>(sql`SELECT
        (${startedAt.toISOString()}::timestamptz AT TIME ZONE timezone)::date::text AS today
        FROM clinics WHERE id = ${fence.clinicId}`);
      if (clinic[0] === undefined) throw new Error("export_clinic_missing");
      const cursor = await tx.cursor<Raw>(exportReportQuery(fence.clinicId, job, clinic[0].today));
      // An own summary has at most 37 monthly buckets for its validated three-year request.
      const months = new Map<string, Raw>();
      try {
        for (;;) {
          await currentJob(tx, fence, signal);
          const page = await cursor.read();
          await currentJob(tx, fence, signal);
          if (page.length === 0) break;
          if (job.scope === "own") {
            const patients = page.map((row) => {
              if (typeof row["patientId"] !== "string")
                throw new Error("export_patient_set_missing");
              const key = `${String(row["period"])}:${String(row["currency"])}`;
              const previous = months.get(key);
              const amount = BigInt(String(row["billedMinor"]));
              months.set(key, {
                ...row,
                billedMinor: (amount + BigInt(String(previous?.["billedMinor"] ?? "0"))).toString(),
              });
              return row["patientId"];
            });
            await recordExportPatients(tx, this.ids, fence, patients);
          } else {
            const named = await withNames(tx, fence.clinicId, job, page);
            await currentJob(tx, fence, signal);
            for (const row of named) {
              signal.throwIfAborted();
              await sink.write(cells(job.report, row));
            }
          }
          await currentJob(tx, fence, signal);
        }
      } catch (error) {
        await cursor.close().catch(() => undefined);
        throw error;
      }
      await cursor.close();
      if (job.scope === "own") {
        for (const row of months.values()) {
          signal.throwIfAborted();
          await sink.write(cells(job.report, row));
        }
      }
      await sink.finish();
      await currentJob(tx, fence, signal);
      if (job.scope === "own") {
        if (!(await ownExportPatientsReachable(tx, fence, job.requestedBy)))
          throw new ExportReadRefused("forbidden");
        await completeExportPatients(tx, this.ids, fence);
      }
      return { patientSet: job.scope === "own" ? ("ledger" as const) : null };
    });
  }
}

async function currentJob(
  tx: Tx,
  fence: ExportFence,
  signal: AbortSignal,
): Promise<PreparedExportJob> {
  signal.throwIfAborted();
  const prepared = await prepareExportInTransaction(tx, fence, false);
  if (prepared.kind !== "ready") throw new ExportReadRefused(prepared.kind);
  signal.throwIfAborted();
  return prepared.job;
}
