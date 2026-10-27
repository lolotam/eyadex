import { randomUUID } from "node:crypto";
import { reportExportResponseSchema, type ReportId } from "@eyadex/contracts/finance-reports";
import { fieldCipherFromEnv } from "@eyadex/secrets";
import { expect } from "vitest";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { reportFixture } from "./report-fixtures.ts";

export async function exportHttpFixture() {
  const bytes = new Map<string, Buffer>();
  const reads: string[] = [];
  const deletes: string[] = [];
  let onGet: (() => Promise<void>) | null = null;
  const f = await reportFixture({
    maxQueuedPerClinic: 10,
    files: {
      async get(key) {
        reads.push(key);
        await onGet?.();
        const value = bytes.get(key);
        if (!value) throw new Error("missing fixture file");
        return value;
      },
      async delete(key) {
        deletes.push(key);
        bytes.delete(key);
      },
    },
  });
  const body = (report: ReportId = "daily_takings", extra: Record<string, unknown> = {}) => ({
    report,
    from: "2026-01-01",
    to: "2026-12-31",
    format: "csv",
    language: "en",
    ...extra,
  });
  const call = (cookie: string, method: "GET" | "POST", path = "", input?: unknown) =>
    send(f.h, cookie, method, `/v1/finance-reports/exports${path}`, input);
  async function published(
    cookie = f.C.admin.cookie,
    report: ReportId = "daily_takings",
    patientIds: readonly string[] | null = null,
  ) {
    const res = await call(cookie, "POST", "", body(report));
    expect(res.statusCode, res.body).toBe(202);
    const id = reportExportResponseSchema.parse(res.json()).export.id;
    const key = `clinic/${f.C.clinicId}/finance-exports/${id}/1.csv`;
    let file = Buffer.from("sample export");
    if (["outstanding", "patient_credit", "refunds", "discounts"].includes(report)) {
      file = Buffer.from(
        fieldCipherFromEnv(process.env).sealBytes(
          f.C.clinicId,
          { table: "finance_report_exports", column: "blob", rowId: `${id}:1` },
          file,
        ),
      );
    }
    bytes.set(key, file);
    await f.h
      .owner`UPDATE finance_report_exports SET status = 'done', attempt = 1, storage_key = ${key},
      byte_size = ${file.length}, row_count = 1, finished_at = clock_timestamp(), expires_at = clock_timestamp() + interval '24 hours',
      patient_ids = CASE WHEN ${patientIds === null} THEN NULL ELSE string_to_array(${patientIds?.join(",") ?? ""}, ',')::uuid[] END
      WHERE clinic_id = ${f.C.clinicId} AND id = ${id}`;
    await f.h
      .owner`INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key,
      state, created_at, updated_at) VALUES (${f.C.clinicId}, ${randomUUID()}, ${id}, 1, ${key}, 'published', clock_timestamp(), clock_timestamp())`;
    return { id, key, path: `/${id}/download` };
  }
  return {
    ...f,
    bytes,
    reads,
    deletes,
    body,
    call,
    published,
    onGet(fn: (() => Promise<void>) | null) {
      onGet = fn;
    },
  };
}
export type ExportHttpFixture = Awaited<ReturnType<typeof exportHttpFixture>>;
