import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { FieldCipher, SealedFile } from "@eyadex/secrets";
import { ExportRunner } from "../export-runner.ts";
import type { ExportStore, PreparedExportJob } from "../ports/export-store.ts";
import type {
  ExportAttemptBlobs,
  ExportBlobStore,
  ExportReportReader,
} from "../ports/export-builder.ts";
import type { ExportCsvRow } from "../domain/export-cells.ts";
import { ExportReadRefused } from "../domain/export-read-refused.ts";

export const fence = { clinicId: "clinic", exportId: "export", attempt: 1, leaseOwner: "worker" };
export const key = "clinic/clinic/finance-exports/export/1.csv";
export const job: PreparedExportJob = {
  requestedBy: "member",
  userId: "user",
  report: "own_summary",
  scope: "own",
  format: "csv",
  params: { from: "2026-10-01", to: "2026-10-27", language: "en", branchIds: ["branch"] },
};
export const row: ExportCsvRow = {
  period: { kind: "date", value: "2026-10" },
  billedMinor: { kind: "money", minor: 12500n, exponent: 3 },
  currency: { kind: "text", value: "KWD" },
};

export async function decodeFile(file: Parameters<ExportBlobStore["put"]>[1], cipher: FieldCipher) {
  const signal = new AbortController().signal;
  const received = await SealedFile.receive(
    file.ciphertext(),
    cipher,
    fence.clinicId,
    {
      table: "finance_report_exports",
      column: "blob",
      rowId: `${fence.exportId}:${fence.attempt}`,
    },
    signal,
  );
  try {
    await received.verify(signal);
    const parts = [];
    for await (const chunk of received.plaintext(signal)) parts.push(chunk);
    return Buffer.concat(parts);
  } finally {
    await received.dispose();
  }
}

export function setup() {
  const store = {
    decideClaim: vi.fn(),
    release: vi.fn(),
    readLeasedJob: vi.fn(),
    prepareLeasedJob: vi
      .fn<ExportStore["prepareLeasedJob"]>()
      .mockResolvedValue({ kind: "ready", job }),
    heartbeat: vi.fn<ExportStore["heartbeat"]>().mockResolvedValue({ kind: "applied" }),
    allocateBlob: vi
      .fn<ExportStore["allocateBlob"]>()
      .mockResolvedValue({ kind: "allocated", blobId: "blob", storageKey: key }),
    markUploaded: vi.fn<ExportStore["markUploaded"]>().mockResolvedValue({ kind: "uploaded" }),
    publish: vi.fn<ExportStore["publish"]>().mockResolvedValue({ kind: "published" }),
    reread: vi.fn<ExportStore["reread"]>().mockResolvedValue("lost_lease"),
    abandon: vi.fn<ExportStore["abandon"]>().mockResolvedValue({ kind: "applied" }),
    recordFailure: vi.fn<ExportStore["recordFailure"]>().mockResolvedValue({ kind: "applied" }),
  } satisfies ExportStore;
  const ledger = {
    uploadable: vi.fn<ExportAttemptBlobs["uploadable"]>().mockResolvedValue(key),
    discardable: vi.fn<ExportAttemptBlobs["discardable"]>().mockResolvedValue(null),
    markDeleted: vi.fn<ExportAttemptBlobs["markDeleted"]>().mockResolvedValue(),
  };
  const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);
  vi.spyOn(cipher, "sealBytes");
  const uploads: Buffer[] = [];
  const stored: Buffer[] = [];
  const blobs = {
    put: vi.fn<ExportBlobStore["put"]>().mockImplementation(async (_, file) => {
      const parts = [];
      for await (const bytes of file.ciphertext()) parts.push(Buffer.from(bytes));
      stored.push(Buffer.concat(parts));
      uploads.push(await decodeFile(file, cipher));
    }),
    delete: vi.fn<ExportBlobStore["delete"]>().mockResolvedValue(),
    exists: vi.fn<ExportBlobStore["exists"]>().mockResolvedValue(false),
  };
  type Produce = (
    f: typeof fence,
    j: PreparedExportJob,
    s: AbortSignal,
  ) => Promise<{ rows: readonly ExportCsvRow[]; patientIds: readonly string[] | null }>;
  const reader = {
    read: vi.fn<Produce>().mockResolvedValue({ rows: [row], patientIds: ["patient"] }),
  };
  const streaming: ExportReportReader = {
    async read(f, current, signal, sink) {
      let abort = () => {};
      const stopped = new Promise<never>((_, reject) => {
        abort = () => reject(new ExportReadRefused("lost_lease"));
        signal.addEventListener("abort", abort, { once: true });
      });
      try {
        if (signal.aborted) abort();
        const data = await Promise.race([reader.read(f, current, signal), stopped]);
        signal.throwIfAborted();
        await sink.start(current);
        for (const value of data.rows) await sink.write(value);
        await sink.finish();
        return { patientSet: current.scope === "own" ? "ledger" : null };
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
  const deps = {
    store,
    ledger,
    blobs,
    reader: streaming,
    cipher,
    heartbeatMs: 20_000,
    budgetMs: 900_000,
  };
  const run = (signal = new AbortController().signal) =>
    new ExportRunner(deps).execute(fence, signal);
  return { ...deps, reader, deps, run, uploads, stored };
}
