import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "@eyadex/db";

import { PgExportSweeper } from "../persistence/pg-export-sweeper.ts";
import {
  insertBlob,
  insertExport,
  markRunning,
  owner,
  readBlobs,
  readExport,
  seedWorld,
  urls,
} from "./export-fixtures.ts";

let db: Database;
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
});
afterAll(async () => db.close());

function setup(
  state: "allocated" | "uploaded" | "published" | "deleted" | "gone",
  expired = false,
) {
  const w = seedWorld();
  const exportId = insertExport(w, { scope: "own", report: "own_summary" });
  markRunning(w.clinicId, exportId, { attempt: 2, owner: "worker", lease: "live" });
  const blobId = insertBlob(w.clinicId, exportId, 2, state, "csv");
  const key = `clinic/${w.clinicId}/finance-exports/${exportId}/2.csv`;
  if (state === "published")
    owner(`UPDATE finance_report_exports SET status = 'done', storage_key = '${key}',
    lease_owner = NULL, lease_until = NULL, expires_at = clock_timestamp() + interval '${expired ? "-1 second" : "1 hour"}',
    patient_ids = ARRAY['${randomUUID()}']::uuid[] WHERE clinic_id = '${w.clinicId}' AND id = '${exportId}'`);
  const files = new Set([key]);
  const blobs = {
    put: vi.fn(),
    delete: vi.fn(async (k: string) => {
      files.delete(k);
    }),
    exists: vi.fn(async (k: string) => files.has(k)),
  };
  const sweep = () => new PgExportSweeper(db, blobs).sweepClinic(w.clinicId);
  const age = () =>
    owner(`UPDATE finance_report_export_blobs SET created_at = clock_timestamp() - interval '17 minutes',
    deleted_at = CASE WHEN state IN ('deleted','gone') THEN clock_timestamp() - interval '23 minutes' ELSE NULL END
    WHERE clinic_id = '${w.clinicId}' AND id = '${blobId}'`);
  return { ...w, exportId, blobId, key, files, blobs, sweep, age };
}

describe("durable export cleanup without bucket listing", () => {
  it.each(["allocated", "uploaded"] as const)(
    "never deletes the live %s attempt, even past build age",
    async (state) => {
      const t = setup(state);
      t.age();
      await t.sweep();
      expect(t.files.has(t.key)).toBe(true);
      expect(t.blobs.delete).not.toHaveBeenCalled();
      expect(readBlobs(t.clinicId, t.exportId)[0]?.state).toBe(state);
    },
  );

  it.each(["allocated", "uploaded"] as const)(
    "deletes a dead aged %s attempt and records the first delete",
    async (state) => {
      const t = setup(state);
      t.age();
      owner(`UPDATE finance_report_exports SET lease_until = clock_timestamp() - interval '1 second'
      WHERE clinic_id = '${t.clinicId}' AND id = '${t.exportId}'`);
      await t.sweep();
      await t.sweep();
      expect(t.files.has(t.key)).toBe(false);
      expect(t.blobs.delete).toHaveBeenCalledTimes(1);
      expect(readBlobs(t.clinicId, t.exportId)[0]?.state).toBe("deleted");
    },
  );

  it("deletes a younger losing attempt without touching the current winner", async () => {
    const t = setup("uploaded");
    insertBlob(t.clinicId, t.exportId, 1, "uploaded", "csv");
    const old = t.key.replace("/2.csv", "/1.csv");
    t.files.add(old);
    await t.sweep();
    expect(t.blobs.delete).toHaveBeenCalledWith(old);
    expect(t.files.has(t.key)).toBe(true);
  });

  it("keeps a published file for 24 hours then expires its row and clears patient ids", async () => {
    const live = setup("published");
    await live.sweep();
    expect(live.blobs.delete).not.toHaveBeenCalled();
    const t = setup("published", true);
    await t.sweep();
    await t.sweep();
    expect(readExport(t.clinicId, t.exportId)).toMatchObject({
      status: "expired",
      storage_key: null,
      patient_ids: null,
    });
    expect(t.files.has(t.key)).toBe(false);
    expect(t.blobs.delete).toHaveBeenCalledTimes(1);
  });

  it("a late write is deleted a second time after the grace period; gone stays final", async () => {
    const t = setup("deleted");
    t.age();
    await t.sweep();
    await t.sweep();
    expect(t.blobs.exists).toHaveBeenCalledWith(t.key);
    expect(readBlobs(t.clinicId, t.exportId)[0]?.state).toBe("gone");
    expect(t.blobs.delete).toHaveBeenCalledTimes(1);
  });

  it("a write between re-delete and stat keeps deleted and starts a new grace period", async () => {
    const t = setup("deleted");
    t.age();
    t.blobs.exists.mockResolvedValue(true);
    await t.sweep();
    await t.sweep();
    expect(readBlobs(t.clinicId, t.exportId)[0]?.state).toBe("deleted");
    expect(t.blobs.delete).toHaveBeenCalledTimes(1);
  });

  it("does not mark the ledger when deletion fails", async () => {
    const t = setup("published", true);
    t.blobs.delete.mockRejectedValue(new Error("unavailable"));
    await expect(t.sweep()).rejects.toThrow("unavailable");
    expect(readExport(t.clinicId, t.exportId)?.status).toBe("done");
    expect(readBlobs(t.clinicId, t.exportId)[0]?.state).toBe("published");
  });

  it("purged rows keep their ids until expiry and are never changed to expired", async () => {
    const t = setup("published", true);
    owner(`UPDATE finance_report_exports SET status = 'purged', storage_key = NULL WHERE clinic_id = '${t.clinicId}' AND id = '${t.exportId}';
      UPDATE finance_report_export_blobs SET state = 'deleted', deleted_at = clock_timestamp() WHERE clinic_id = '${t.clinicId}' AND id = '${t.blobId}'`);
    await t.sweep();
    expect(readExport(t.clinicId, t.exportId)).toMatchObject({
      status: "purged",
      patient_ids: null,
    });
  });
});
