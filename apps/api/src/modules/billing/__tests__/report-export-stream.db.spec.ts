import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { DOWNLOAD_REPORT_EXPORT } from "../http/report-exports.controller.ts";
import type { DownloadReportExport } from "../use-cases/report-exports/download-report-export.ts";
import { exportHttpFixture, type ExportHttpFixture } from "./report-export-http.fixtures.ts";

let f: ExportHttpFixture;
beforeAll(async () => {
  f = await exportHttpFixture();
}, 60_000);
afterAll(async () => {
  await closeHarness(f.h);
});

describe("bounded export download responses", () => {
  it.each(["corrupt-final", "truncated"])(
    "sends no attachment bytes for %s, and releases its slot",
    async (kind) => {
      const row = await f.published();
      const original = f.bytes.get(row.key)!;
      const damaged = Buffer.from(original);
      damaged[damaged.length - 5] = damaged[damaged.length - 5]! ^ 1;
      f.bytes.set(row.key, kind === "truncated" ? original.subarray(0, -5) : damaged);
      const response = await f.call(f.C.admin.cookie, "GET", row.path);
      expect(response.statusCode, response.body).toBe(503);
      expect(response.headers["content-disposition"]).toBeUndefined();
      expect(response.body).not.toContain("sample export");
      f.bytes.set(row.key, original);
      expect((await f.call(f.C.admin.cookie, "GET", row.path)).body).toBe("sample export");
    },
  );

  it("refuses a third concurrent download without a waiting queue, then recovers after completion", async () => {
    const row = await f.published();
    let entered = 0;
    let ready = () => {};
    const waiting = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let resume = () => {};
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    f.onGet(async () => {
      if (++entered === 2) ready();
      await held;
    });
    const first = f.call(f.C.admin.cookie, "GET", row.path);
    const second = f.call(f.C.admin.cookie, "GET", row.path);
    try {
      await waiting;
      const response = await f.call(f.C.admin.cookie, "GET", row.path);
      expect(response.statusCode, response.body).toBe(503);
      expect(entered).toBe(2);
    } finally {
      f.onGet(null);
      resume();
    }
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect((await f.call(f.C.admin.cookie, "GET", row.path)).statusCode).toBe(200);
  });

  it("requires the winning attempt's complete ledger and purges a patient outside current own reach", async () => {
    const row = await f.published(f.C.doctor.cookie, "own_summary");
    await f.h
      .owner`UPDATE finance_report_exports SET patient_set_mode = 'ledger' WHERE clinic_id = ${f.C.clinicId} AND id = ${row.id}`;
    const count = f.reads.length;
    expect((await f.call(f.C.doctor.cookie, "GET", row.path)).statusCode).toBe(404);
    expect(f.reads).toHaveLength(count);
    await f.h.owner`INSERT INTO finance_report_export_patients
      (clinic_id, id, export_id, attempt, is_complete, created_at)
      VALUES (${f.C.clinicId}, ${randomUUID()}, ${row.id}, 1, true, clock_timestamp())`;
    expect((await f.call(f.C.doctor.cookie, "GET", row.path)).statusCode).toBe(200);
    await f.h.owner`INSERT INTO finance_report_export_patients
      (clinic_id, id, export_id, attempt, patient_id, created_at)
      VALUES (${f.C.clinicId}, ${randomUUID()}, ${row.id}, 1, ${f.patientD}, clock_timestamp())`;
    expect((await f.call(f.C.doctor.cookie, "GET", row.path)).statusCode).toBe(404);
    expect(f.deletes).toContain(row.key);
    expect(f.bytes.has(row.key)).toBe(false);
  });

  it("shutdown cancels a storage source stalled after its first chunk and waits for slot cleanup", async () => {
    const row = await f.published();
    let stalled = () => {};
    const waiting = new Promise<void>((resolve) => {
      stalled = resolve;
    });
    let sent = false;
    const source = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push(f.bytes.get(row.key)!.subarray(0, 8));
        } else stalled();
      },
    });
    f.onSource(() => source);
    const response = f.call(f.C.admin.cookie, "GET", row.path);
    await waiting;
    const downloads = f.h.app.get<DownloadReportExport>(DOWNLOAD_REPORT_EXPORT);
    await downloads.onApplicationShutdown();
    expect(source.destroyed).toBe(true);
    expect((await response).body).not.toContain("sample export");
    f.onSource(null);
  });
});
