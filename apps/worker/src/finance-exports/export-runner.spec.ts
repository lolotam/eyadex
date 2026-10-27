import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldCipher } from "@eyadex/secrets";

import { ExportRunner } from "./export-runner.ts";
import { ExportReadRefused } from "./domain/export-read-refused.ts";
import type { ExportStore, PreparedExportJob } from "./ports/export-store.ts";
import type {
  ExportAttemptBlobs,
  ExportBlobStore,
  ExportReportReader,
} from "./ports/export-builder.ts";
import type { ExportCsvRow } from "./domain/export-cells.ts";

const fence = { clinicId: "clinic", exportId: "export", attempt: 1, leaseOwner: "worker" };
const key = "clinic/clinic/finance-exports/export/1.csv";
const job: PreparedExportJob = {
  requestedBy: "member",
  userId: "user",
  report: "own_summary",
  scope: "own",
  format: "csv",
  params: { from: "2026-10-01", to: "2026-10-27", language: "en", branchIds: ["branch"] },
};
const row: ExportCsvRow = {
  period: { kind: "date", value: "2026-10" },
  billedMinor: { kind: "money", minor: 12500n, exponent: 3 },
  currency: { kind: "text", value: "KWD" },
};
function setup() {
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
  const blobs = {
    put: vi.fn<ExportBlobStore["put"]>().mockResolvedValue(),
    delete: vi.fn<ExportBlobStore["delete"]>().mockResolvedValue(),
    exists: vi.fn<ExportBlobStore["exists"]>().mockResolvedValue(false),
  };
  const reader = {
    read: vi
      .fn<ExportReportReader["read"]>()
      .mockResolvedValue({ rows: [row], patientIds: ["patient"] }),
  };
  const cipher = { sealBytes: vi.fn<FieldCipher["sealBytes"]>().mockReturnValue("sealed") };
  const deps = { store, ledger, blobs, reader, cipher, heartbeatMs: 20_000, budgetMs: 900_000 };
  const run = (signal = new AbortController().signal) =>
    new ExportRunner(deps).execute(fence, signal);
  return { ...deps, deps, run };
}

afterEach(() => vi.useRealTimers());

describe("export attempt after commit", () => {
  it("writes real CSV only after access, allocation and the last upload check", async () => {
    const t = setup();
    const order: string[] = [];
    t.reader.read.mockImplementation(async () => {
      order.push("read");
      return { rows: [row], patientIds: ["patient"] };
    });
    t.store.allocateBlob.mockImplementation(async () => {
      order.push("allocate");
      return { kind: "allocated", storageKey: key, blobId: "blob" };
    });
    t.ledger.uploadable.mockImplementation(async () => {
      order.push("check");
      return key;
    });
    t.blobs.put.mockImplementation(async (_, bytes) => {
      order.push("put");
      expect(bytes.toString("utf8")).toContain("12.500");
    });
    t.store.markUploaded.mockImplementation(async () => {
      order.push("uploaded");
      return { kind: "uploaded" };
    });
    t.store.publish.mockImplementation(async (_, input) => {
      order.push("publish");
      expect(input.patientIds).toEqual(["patient"]);
      expect(input.rowCount).toBe(1);
      return { kind: "published" };
    });
    await t.run();
    expect(order).toEqual(["read", "allocate", "check", "put", "uploaded", "publish"]);
    expect(t.blobs.delete).not.toHaveBeenCalled();
    expect(t.store.recordFailure).not.toHaveBeenCalled();
    expect(t.cipher.sealBytes).not.toHaveBeenCalled();
  });

  it("writes real XLSX instead of a CSV renamed to xlsx", async () => {
    const t = setup();
    t.store.prepareLeasedJob.mockResolvedValue({ kind: "ready", job: { ...job, format: "xlsx" } });
    await t.run();
    expect(t.blobs.put.mock.calls[0]?.[1].subarray(0, 2).toString()).toBe("PK");
  });

  it("seals patient named bytes with clinic/export/attempt bound additional data", async () => {
    const t = setup();
    t.store.prepareLeasedJob.mockResolvedValue({
      kind: "ready",
      job: { ...job, report: "patient_credit", scope: "clinic" },
    });
    t.reader.read.mockResolvedValue({ rows: [], patientIds: null });
    await t.run();
    expect(t.cipher.sealBytes).toHaveBeenCalledWith(
      "clinic",
      {
        table: "finance_report_exports",
        column: "blob",
        rowId: "export:1",
      },
      expect.any(Buffer),
    );
    expect(t.blobs.put.mock.calls[0]?.[1].toString()).toBe("sealed");
  });

  it.each(["forbidden", "invalid_params", "lost_lease"] as const)(
    "stops before reading report data for %s",
    async (kind) => {
      const t = setup();
      t.store.prepareLeasedJob.mockResolvedValue({ kind });
      await t.run();
      expect(t.reader.read).not.toHaveBeenCalled();
      expect(t.blobs.put).not.toHaveBeenCalled();
      if (kind !== "lost_lease")
        expect(t.store.recordFailure).toHaveBeenCalledWith(
          fence,
          kind === "forbidden" ? "forbidden" : "build_failed",
        );
    },
  );

  it.each([
    ["forbidden", "forbidden"],
    ["lost_lease", "lease_lost"],
    ["invalid_params", "build_failed"],
  ] as const)("stops before allocation when the actual read refuses %s", async (reason, kind) => {
    const t = setup();
    t.reader.read.mockRejectedValue(new ExportReadRefused(reason));
    await t.run();
    expect(t.store.recordFailure).toHaveBeenCalledWith(fence, kind);
    expect(t.store.allocateBlob).not.toHaveBeenCalled();
    expect(t.blobs.put).not.toHaveBeenCalled();
  });

  it("refuses wide CSV money without allocating or uploading", async () => {
    const t = setup();
    t.reader.read.mockResolvedValue({
      rows: [{ ...row, billedMinor: { kind: "money", minor: 12345678901234567n, exponent: 3 } }],
      patientIds: [],
    });
    await t.run();
    expect(t.store.recordFailure).toHaveBeenCalledWith(fence, "export_amount_too_large");
    expect(t.store.allocateBlob).not.toHaveBeenCalled();
    expect(t.blobs.put).not.toHaveBeenCalled();
  });

  it("never sends PUT after the preupload check finds a swept key", async () => {
    const t = setup();
    t.ledger.uploadable.mockResolvedValue(null);
    await t.run();
    expect(t.blobs.put).not.toHaveBeenCalled();
    expect(t.store.publish).not.toHaveBeenCalled();
  });

  it("deletes a late PUT only after rereading, then marks its own blob", async () => {
    const t = setup();
    const order: string[] = [];
    t.store.markUploaded.mockResolvedValue({ kind: "refused" });
    t.store.reread.mockImplementation(async () => {
      order.push("reread");
      return "lost_lease";
    });
    t.ledger.discardable.mockResolvedValue(key);
    t.blobs.delete.mockImplementation(async () => {
      order.push("delete");
    });
    t.ledger.markDeleted.mockImplementation(async () => {
      order.push("mark");
    });
    await t.run();
    expect(order).toEqual(["reread", "reread", "delete", "mark"]);
    expect(t.store.publish).not.toHaveBeenCalled();
  });

  it("retains a committed file after the publish response is lost", async () => {
    const t = setup();
    t.store.publish.mockRejectedValue(new Error("transport"));
    t.store.reread.mockResolvedValue("own_success");
    t.ledger.discardable.mockResolvedValue(key);
    await t.run();
    expect(t.blobs.delete).not.toHaveBeenCalled();
    expect(t.store.recordFailure).not.toHaveBeenCalled();
  });

  it.each(["lost_lease", "own_success"] as const)(
    "a %s heartbeat stops a blocked reader and never uploads",
    async (kind) => {
      vi.useFakeTimers();
      const t = setup();
      t.reader.read.mockImplementation(() => new Promise(() => {}));
      t.store.heartbeat.mockResolvedValue({ kind });
      const running = t.run();
      await vi.advanceTimersByTimeAsync(20_000);
      await running;
      expect(t.blobs.put).not.toHaveBeenCalled();
      expect(t.store.recordFailure).not.toHaveBeenCalled();
      expect(t.store.abandon).not.toHaveBeenCalled();
    },
  );

  it("renews throughout a slow build and releases the timer after publish", async () => {
    vi.useFakeTimers();
    const t = setup();
    let release = () => {};
    t.reader.read.mockImplementation(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { rows: [row], patientIds: [] };
    });
    const running = t.run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.store.heartbeat).toHaveBeenCalledTimes(3);
    release();
    await running;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.store.heartbeat).toHaveBeenCalledTimes(3);
  });

  it.each(["budget", "shutdown"])(
    "abandons a blocked attempt on %s without a late upload",
    async (why) => {
      vi.useFakeTimers();
      const t = setup();
      const stop = new AbortController();
      t.deps.budgetMs = 10;
      let release = () => {};
      t.reader.read.mockImplementation(async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { rows: [row], patientIds: [] };
      });
      const running = t.run(stop.signal);
      await vi.advanceTimersByTimeAsync(0);
      if (why === "shutdown") stop.abort();
      else await vi.advanceTimersByTimeAsync(10);
      await running;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.store.abandon).toHaveBeenCalledWith(fence);
      expect(t.blobs.put).not.toHaveBeenCalled();
    },
  );

  it("does not mark deleted when the store refuses deletion", async () => {
    const t = setup();
    t.store.publish.mockResolvedValue({ kind: "lost_lease" });
    t.ledger.discardable.mockResolvedValue(key);
    t.blobs.delete.mockRejectedValue(new Error("store"));
    await t.run();
    expect(t.ledger.markDeleted).not.toHaveBeenCalled();
  });

  it("does not delete on an inconclusive database reread", async () => {
    const t = setup();
    t.store.publish.mockRejectedValue(new Error("transport"));
    t.store.reread.mockRejectedValue(new Error("database"));
    t.ledger.discardable.mockResolvedValue(key);
    await t.run();
    expect(t.blobs.delete).not.toHaveBeenCalled();
  });
});
