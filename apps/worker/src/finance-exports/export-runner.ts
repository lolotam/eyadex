import type { FieldCipher } from "@eyadex/secrets";

import { ExportFileWriter } from "./export-file-writer.ts";
import type { ExportFailureKind } from "./domain/export-failures.ts";
import { ExportReadRefused } from "./domain/export-read-refused.ts";
import { ExportHeartbeat } from "./export-heartbeat.ts";
import type {
  ExportAttemptBlobs,
  ExportBlobStore,
  ExportReportReader,
} from "./ports/export-builder.ts";
import type { ExportFence, ExportStore } from "./ports/export-store.ts";

/** اعتمادات تنفيذ محاولة بعد الالتزام فقط. */
export interface ExportRunnerDeps {
  readonly store: ExportStore;
  readonly ledger: ExportAttemptBlobs;
  readonly blobs: ExportBlobStore;
  readonly reader: ExportReportReader;
  readonly cipher: FieldCipher;
  readonly heartbeatMs?: number;
  readonly budgetMs?: number;
}

class AttemptFailure extends Error {
  constructor(readonly kind: ExportFailureKind) {
    super(kind);
  }
}

/**
 * يبني ويرفع وينشر بعد التزام claim. النبض طول المحاولة، والحذف بعد إعادة القراءة
 * بس، عشان جواب نشر ضايع مايمسحش الملف الفائز. مفيش transaction عبر شبكة التخزين.
 */
export class ExportRunner {
  constructor(private readonly deps: ExportRunnerDeps) {
    for (const value of [deps.heartbeatMs ?? 20_000, deps.budgetMs ?? 900_000]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("invalid_export_timer");
    }
  }

  readonly execute = async (fence: ExportFence, stopping: AbortSignal): Promise<void> => {
    if (stopping.aborted) return;
    const controller = new AbortController();
    let budgetEnded = false;
    const cancel = () => controller.abort();
    stopping.addEventListener("abort", cancel, { once: true });
    const budget = setTimeout(() => {
      budgetEnded = true;
      controller.abort();
    }, this.deps.budgetMs ?? 900_000);
    budget.unref();
    const pulse = new ExportHeartbeat(this.deps.store, fence, controller, this.deps.heartbeatMs);
    let published = false;
    let failure: ExportFailureKind | null = null;
    let writer: ExportFileWriter | undefined;
    try {
      const prepared = await this.deps.store.prepareLeasedJob(fence);
      if (prepared.kind === "lost_lease") return;
      if (prepared.kind !== "ready") {
        throw new AttemptFailure(prepared.kind === "forbidden" ? "forbidden" : "build_failed");
      }
      controller.signal.throwIfAborted();
      const { job } = prepared;
      const allocated = await this.deps.store.allocateBlob(fence);
      if (allocated.kind === "lost_lease") return;
      // Await the cooperative reader, so no delayed file creation/write can escape cleanup.
      const data = await this.deps.reader.read(fence, job, controller.signal, {
        start: async (current) => {
          writer = await ExportFileWriter.create(
            fence,
            current,
            this.deps.cipher,
            controller.signal,
          );
        },
        write: async (row) => {
          if (!writer) throw new Error("export_writer_missing");
          await writer.write(row);
        },
        finish: async () => {
          if (!writer) throw new Error("export_writer_missing");
          await writer.finish();
        },
      });
      controller.signal.throwIfAborted();
      if (!writer) throw new AttemptFailure("build_failed");
      const key = await this.deps.ledger.uploadable(fence);
      if (key === null || key !== allocated.storageKey) return;
      controller.signal.throwIfAborted();
      try {
        await untilAborted(
          this.deps.blobs.put(key, writer.file, controller.signal),
          controller.signal,
        );
      } catch {
        throw new AttemptFailure("store_unavailable");
      }
      controller.signal.throwIfAborted();
      if ((await this.deps.store.markUploaded(fence)).kind !== "uploaded") return;
      controller.signal.throwIfAborted();
      // A publish already sent is awaited even on cancellation, before any cleanup decision.
      const result = await this.deps.store.publish(fence, {
        byteSize: writer.file.storedLength,
        rowCount: writer.rowCount,
        patientIds: data.patientSet === "ledger" ? [] : null,
        patientSet: data.patientSet,
      });
      published = result.kind === "published" || result.kind === "own_success";
      if (result.kind === "refused") throw new AttemptFailure("build_failed");
    } catch (error) {
      failure =
        error instanceof AttemptFailure
          ? error.kind
          : error instanceof ExportReadRefused
            ? error.reason === "forbidden"
              ? "forbidden"
              : error.reason === "lost_lease"
                ? "lease_lost"
                : "build_failed"
            : error instanceof Error && error.message === "export_amount_too_large"
              ? "export_amount_too_large"
              : error instanceof Error && error.message === "export_value_invalid"
                ? "build_failed"
                : "db_error";
    } finally {
      clearTimeout(budget);
      stopping.removeEventListener("abort", cancel);
      await pulse.stop();
      try {
        await writer?.dispose();
      } catch {
        failure ??= "db_error";
      }
      // Even a thrown commit response can be durable. A DB outage leaves cleanup to the sweeper.
      try {
        if (!published && pulse.outcome !== "own_success") {
          published = (await this.deps.store.reread(fence)) === "own_success";
        } else published = true;
        if (!published) {
          if (pulse.outcome !== "lost_lease") {
            if (budgetEnded || stopping.aborted) await this.deps.store.abandon(fence);
            else if (failure !== null || pulse.outcome === "db_error") {
              await this.deps.store.recordFailure(
                fence,
                pulse.outcome === "db_error" ? "db_error" : (failure ?? "db_error"),
              );
            }
          }
          await this.#discard(fence);
        }
      } catch {
        // The durable blob ledger and the pending outbox event retain recovery work.
      }
    }
  };

  async #discard(fence: ExportFence): Promise<void> {
    if ((await this.deps.store.reread(fence)) === "own_success") return;
    const key = await this.deps.ledger.discardable(fence);
    if (key === null) return;
    await this.deps.blobs.delete(key);
    await this.deps.ledger.markDeleted(fence);
  }
}

/** A cancelled query may finish reading, but can never continue the file pipeline. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new AttemptFailure("lease_lost"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
