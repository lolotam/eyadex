import { sql, type Database, type DispatcherOutbox, type IdGenerator } from "@eyadex/db";
import { ConfigurationError, type Logger } from "@eyadex/observability";
import { medicalCipher } from "../shared/config.ts";
import { OutboxPoller } from "../shared/outbox-poller.ts";
import { PeriodicJob } from "../shared/periodic-job.ts";
import { S3ExportBlobs } from "../shared/blob/s3-export-blobs.ts";
import { readExportRuntimeConfig } from "./export-runtime-config.ts";
import { ExportRunner } from "./export-runner.ts";
import { ExportHandoffQueue } from "./export-handoff-queue.ts";
import { PgExportStore } from "./persistence/pg-export-store.ts";
import { PgExportAttemptBlobs } from "./persistence/pg-export-attempt-blobs.ts";
import { PgExportReports } from "./persistence/pg-export-reports.ts";
import { PgExportSweeper } from "./persistence/pg-export-sweeper.ts";
import { handleExportRequested } from "./handle-export-requested.ts";
import { FINANCE_REPORT_EXPORT_REQUESTED } from "./domain/export-event.ts";

/** Dedicated export poller; export backpressure never pauses mail or other outbox event types. */
export function createFinanceExports(deps: {
  env: NodeJS.ProcessEnv;
  app: Database;
  platform: Database;
  outbox: DispatcherOutbox;
  ids: IdGenerator;
  logger: Logger;
  clock: { now(): Date };
  intervalMs: number;
}) {
  const config = readExportRuntimeConfig(deps.env);
  if (config === null) return null;
  const cipher = medicalCipher(deps.env);
  if (cipher === null) throw new ConfigurationError("worker", ["MEDICAL_MASTER_KEY_V1"]);
  const blobs = new S3ExportBlobs({
    endpoint: config.FINANCE_EXPORT_BLOB_S3_ENDPOINT,
    bucket: config.FINANCE_EXPORT_BLOB_S3_BUCKET,
    region: config.FINANCE_EXPORT_BLOB_S3_REGION,
    accessKey: config.FINANCE_EXPORT_BLOB_S3_ACCESS_KEY,
    secretKey: config.FINANCE_EXPORT_BLOB_S3_SECRET_KEY,
  });
  const store = new PgExportStore(deps.app, deps.ids);
  const runner = new ExportRunner({
    store,
    blobs,
    cipher,
    ledger: new PgExportAttemptBlobs(deps.app),
    reader: new PgExportReports(deps.app, deps.clock),
  });
  const queue = new ExportHandoffQueue({
    execute: runner.execute,
    logger: deps.logger,
    concurrency: config.EXPORT_CONCURRENCY,
  });
  const poller = new OutboxPoller({
    outbox: deps.outbox,
    types: [FINANCE_REPORT_EXPORT_REQUESTED],
    handle: handleExportRequested({
      claims: store,
      handoff: queue,
      leaseOwner: `export-${deps.ids.newId()}`,
      logger: deps.logger,
    }),
    now: deps.clock.now,
    intervalMs: deps.intervalMs,
    logger: deps.logger,
    canClaim: queue.canClaim,
    afterClaim: queue.afterClaim,
  });
  const sweeper = new PgExportSweeper(deps.app, blobs);
  const sweepStop = new AbortController();
  const sweep = new PeriodicJob(async () => {
    try {
      let cursor = "";
      for (;;) {
        if (sweepStop.signal.aborted) break;
        const clinics = await deps.platform.withNoTenant((tx) =>
          tx.execute<{ id: string }>(sql`
          SELECT id FROM clinics WHERE id::text > ${cursor} ORDER BY id LIMIT 500`),
        );
        for (const clinic of clinics) {
          if (sweepStop.signal.aborted) break;
          try {
            await sweeper.sweepClinic(clinic.id, sweepStop.signal);
          } catch {
            deps.logger.error(
              { exportSweep: { clinicId: clinic.id, code: "sweep_failed" } },
              "error",
            );
          }
        }
        if (clinics.length < 500) break;
        cursor = clinics.at(-1)!.id;
      }
    } catch {
      deps.logger.error({ exportSweep: { code: "scan_failed" } }, "error");
    }
  }, config.EXPORT_SWEEP_INTERVAL_MS);
  return {
    async start() {
      await blobs.verifyBucket();
      poller.start();
      sweep.start();
    },
    async stop() {
      sweepStop.abort();
      await poller.stop();
      await Promise.all([queue.stop(), sweep.stop()]);
    },
    close() {
      blobs.close();
    },
  };
}
