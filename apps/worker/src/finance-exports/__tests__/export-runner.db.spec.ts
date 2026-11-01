import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FieldCipher, SealedFile } from "@eyadex/secrets";
import { Readable } from "node:stream";
import { createDatabase, type Database } from "@eyadex/db";

import { PgExportStore } from "../persistence/pg-export-store.ts";
import { PgExportAttemptBlobs } from "../persistence/pg-export-attempt-blobs.ts";
import { PgExportReports } from "../persistence/pg-export-reports.ts";
import { ExportRunner } from "../export-runner.ts";
import { insertBlob, owner, readAudits, readBlobs, readExport, urls } from "./export-fixtures.ts";
import { leaseExport, openMember, revoke } from "./export-prepare-fixtures.ts";

let db: Database;
let store: PgExportStore;
let ledger: PgExportAttemptBlobs;
const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  store = new PgExportStore(db, { newId: randomUUID });
  ledger = new PgExportAttemptBlobs(db);
});
afterAll(async () => db.close());

function setup() {
  const world = openMember(["view:report_own:own", "view:invoices:own"]);
  const { exportId } = leaseExport(world, { report: "own_summary", scope: "own", branchIds: [] });
  const fence = { clinicId: world.clinicId, exportId, attempt: 1, leaseOwner: "worker-a" };
  return { ...world, fence };
}

describe("export runner on the application role", () => {
  it("publishes bytes and exactly one audit with the own patient set", async () => {
    const t = setup();
    const files = new Map<string, Buffer>();
    const runner = new ExportRunner({
      store,
      ledger,
      reader: new PgExportReports(db, { now: () => new Date() }, { newId: randomUUID }),
      blobs: {
        async put(key, file) {
          const parts = [];
          for await (const chunk of file.ciphertext()) parts.push(Buffer.from(chunk));
          files.set(key, Buffer.concat(parts));
        },
        async delete(key) {
          files.delete(key);
        },
        async exists(key) {
          return files.has(key);
        },
      },
      cipher,
    });
    await runner.execute(t.fence, new AbortController().signal);
    const row = readExport(t.clinicId, t.fence.exportId)!;
    expect(row.status).toBe("done");
    expect(row.patient_ids).toEqual([]);
    expect(files.get(row.storage_key!)?.subarray(0, 8).toString()).toBe("EYADEXE1");
    const downloaded = await SealedFile.receive(
      Readable.from([files.get(row.storage_key!)!]),
      cipher,
      t.clinicId,
      { table: "finance_report_exports", column: "blob", rowId: `${t.fence.exportId}:1` },
      new AbortController().signal,
    );
    try {
      expect(await downloaded.verify(new AbortController().signal)).toBeGreaterThan(3);
    } finally {
      await downloaded.dispose();
    }
    expect(readBlobs(t.clinicId, t.fence.exportId)[0]?.state).toBe("published");
    expect(readAudits(t.clinicId, t.fence.exportId)).toHaveLength(1);
    expect(row.lease_owner).toBeNull();
  });

  it("denies a revoked report key while queued, without reading or allocating", async () => {
    const t = setup();
    owner(
      `DELETE FROM role_permissions WHERE clinic_id = '${t.clinicId}' AND role_id = '${t.roleId}'`,
    );
    const read = vi.fn();
    const put = vi.fn();
    const runner = new ExportRunner({
      store,
      ledger,
      reader: { read },
      blobs: { put, delete: vi.fn(), exists: vi.fn() },
      cipher,
    });
    await runner.execute(t.fence, new AbortController().signal);
    expect(read).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(readExport(t.clinicId, t.fence.exportId)).toMatchObject({
      status: "failed",
      error_code: "forbidden",
    });
    expect(readBlobs(t.clinicId, t.fence.exportId)).toEqual([]);
  });

  it("refuses revocation between preflight and the production report reader, deleting its unused allocation", async () => {
    const t = setup();
    const reader = new PgExportReports(db, { now: () => new Date() }, { newId: randomUUID });
    const put = vi.fn();
    const runner = new ExportRunner({
      store,
      ledger,
      reader: {
        async read(...args) {
          revoke(t.clinicId, t.roleId, "view:invoices:own");
          return reader.read(...args);
        },
      },
      blobs: { put, delete: vi.fn(), exists: vi.fn() },
      cipher,
    });
    await runner.execute(t.fence, new AbortController().signal);
    expect(put).not.toHaveBeenCalled();
    expect(readExport(t.clinicId, t.fence.exportId)).toMatchObject({
      status: "failed",
      error_code: "forbidden",
    });
    expect(readBlobs(t.clinicId, t.fence.exportId)).toMatchObject([{ state: "deleted" }]);
  });

  it("preupload requires the live matching lease and an allocated canonical key", async () => {
    const t = setup();
    expect(await ledger.uploadable(t.fence)).toBeNull();
    await store.allocateBlob(t.fence);
    const key = await ledger.uploadable(t.fence);
    expect(key).not.toBeNull();
    expect(await ledger.uploadable({ ...t.fence, leaseOwner: "worker-b" })).toBeNull();
    expect(await ledger.uploadable({ ...t.fence, clinicId: t.otherClinicId })).toBeNull();
    owner(`UPDATE finance_report_exports SET lease_until = clock_timestamp() - interval '1 second'
      WHERE clinic_id = '${t.clinicId}' AND id = '${t.fence.exportId}'`);
    expect(await ledger.uploadable(t.fence)).toBeNull();
  });

  it("a swept key never uploads; cleanup cannot downgrade published, deleted or gone rows", async () => {
    for (const state of ["deleted", "gone", "published"] as const) {
      const t = setup();
      insertBlob(t.clinicId, t.fence.exportId, 1, state, "csv");
      expect(await ledger.uploadable(t.fence)).toBeNull();
      if (state !== "deleted") expect(await ledger.discardable(t.fence)).toBeNull();
      await ledger.markDeleted(t.fence);
      expect(readBlobs(t.clinicId, t.fence.exportId)[0]?.state).toBe(state);
    }
  });
});
