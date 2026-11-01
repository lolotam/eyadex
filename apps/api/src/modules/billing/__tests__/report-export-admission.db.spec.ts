import { reportExportResponseSchema } from "@eyadex/contracts/finance-reports";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendOutboxEvent } from "../../../shared/outbox.ts";
import { reportBranchIds, reportScope } from "../domain/report-scope.ts";
import { FINANCE_REPORT_EXPORT_REQUESTED } from "../events/published.ts";
import {
  ADMIN_KEYS,
  appDatabase,
  CLOCK_AT,
  DESK_KEYS,
  DOCTOR_KEYS,
  exportActor,
  exportBody,
  exportFixture,
  exportUseCase,
  listedBranchIds,
} from "./report-export-admission.fixtures.ts";
import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import type { ReportFixture } from "./report-fixtures.ts";

let f: ReportFixture;

const money = (clinicId: string) =>
  f.h.owner`SELECT
    (SELECT count(*)::int FROM invoices WHERE clinic_id = ${clinicId}) AS invoices,
    (SELECT count(*)::int FROM payments WHERE clinic_id = ${clinicId}) AS payments,
    (SELECT count(*)::int FROM payment_allocations WHERE clinic_id = ${clinicId}) AS allocations,
    (SELECT count(*)::int FROM patient_credits WHERE clinic_id = ${clinicId}) AS credits,
    (SELECT count(*)::int FROM refunds WHERE clinic_id = ${clinicId}) AS refunds,
    (SELECT count(*)::int FROM audit_log WHERE clinic_id = ${clinicId}) AS audit`;

const exportsOf = (clinicId: string) =>
  f.h.owner`SELECT id, requested_by, report, params, format, scope, patient_ids, status, attempt,
      storage_key, lease_owner, created_at
    FROM finance_report_exports WHERE clinic_id = ${clinicId} ORDER BY created_at, id`;

const eventsFor = (exportId: string) =>
  f.h.owner`SELECT event_type, payload FROM outbox_events
    WHERE payload->>'exportId' = ${exportId}`;

beforeAll(async () => {
  f = await exportFixture();
});

afterAll(async () => {
  await closeHarness(f?.h);
});

describe("report export admission", () => {
  it("freezes reachable branches, including inactive, and refuses a foreign filter before insert", async () => {
    const actor = exportActor(f.C.clinicId, f.C.admin.memberId, ADMIN_KEYS, { all: true });
    const before = await money(f.C.clinicId);
    const admitted = await exportUseCase(f).request(actor, exportBody("daily_takings"));
    const parsed = reportExportResponseSchema.parse(admitted);
    expect(Object.keys(parsed.export).sort()).toEqual(
      ["byteSize", "createdAt", "expiresAt", "format", "id", "report", "rowCount", "status"].sort(),
    );
    expect(parsed.export).toMatchObject({
      report: "daily_takings",
      format: "csv",
      status: "queued",
      createdAt: CLOCK_AT,
      expiresAt: null,
      byteSize: null,
      rowCount: null,
    });
    const [row] = await exportsOf(f.C.clinicId);
    const ids = await listedBranchIds(appDatabase(f), f.C.clinicId);
    const reach = reportScope(actor, "daily_takings");
    expect(ids).toContain(f.C.branchR);
    expect(row).toMatchObject({
      id: parsed.export.id,
      requested_by: f.C.admin.memberId,
      status: "queued",
      attempt: 0,
      scope: "clinic",
      patient_ids: null,
      storage_key: null,
      lease_owner: null,
    });
    expect(row!["params"]).toEqual({
      from: "2024-01-01",
      to: "2026-12-31",
      language: "ar",
      branchIds: reportBranchIds(reach!, ids),
      groupBy: "day",
    });
    expect(row!["params"]).not.toHaveProperty("branchId");
    const narrowed = await exportUseCase(f).request(
      actor,
      exportBody("period_summary", { branchId: f.C.branchR }),
    );
    const narrowedRow = (await exportsOf(f.C.clinicId)).find(
      (item) => item["id"] === narrowed.export.id,
    );
    expect(narrowedRow!["params"]).toMatchObject({ branchIds: [f.C.branchR], groupBy: "month" });
    const exportsBefore = await exportsOf(f.C.clinicId);
    const eventsBefore = await f.h
      .owner`SELECT id, event_type, payload FROM outbox_events WHERE clinic_id = ${f.C.clinicId} ORDER BY created_at, id`;
    await expect(
      exportUseCase(f).request(actor, exportBody("by_service", { branchId: f.other.branchD })),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await exportsOf(f.C.clinicId)).toEqual(exportsBefore);
    expect(
      await f.h
        .owner`SELECT id, event_type, payload FROM outbox_events WHERE clinic_id = ${f.C.clinicId} ORDER BY created_at, id`,
    ).toEqual(eventsBefore);
    expect(await money(f.C.clinicId)).toEqual(before);
    const events = await eventsFor(parsed.export.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: FINANCE_REPORT_EXPORT_REQUESTED });
    expect(events[0]!["payload"]).toEqual({ exportId: parsed.export.id });
  });

  it("admits the receptionist's takings reports and the doctor's own summary only", async () => {
    const desk = exportActor(f.C.clinicId, f.desk.memberId, DESK_KEYS, {
      all: false,
      branchIds: [f.C.branchR],
    });
    const doctor = exportActor(f.C.clinicId, f.C.doctor.memberId, DOCTOR_KEYS, {
      all: false,
      branchIds: [f.C.branchD],
    });
    const takings = await exportUseCase(f).request(desk, exportBody("cash_closings"));
    expect(takings.export.report).toBe("cash_closings");
    await expect(exportUseCase(f).request(desk, exportBody("outstanding"))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      exportUseCase(f).request(desk, exportBody("patient_credit")),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    const own = await exportUseCase(f).request(doctor, exportBody("own_summary"));
    expect(own.export).toMatchObject({ report: "own_summary", status: "queued" });
    await expect(
      exportUseCase(f).request(
        exportActor(
          f.C.clinicId,
          f.C.doctor.memberId,
          ["view:report_own:own", "view:invoices:branch"],
          {
            all: false,
            branchIds: [f.C.branchD],
          },
        ),
        exportBody("own_summary"),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const ownRow = (await exportsOf(f.C.clinicId)).find((row) => row["id"] === own.export.id);
    expect(ownRow).toMatchObject({ scope: "own", patient_ids: null, storage_key: null });
  });

  it("caps one clinic's queue and refuses a second running export for the same member", async () => {
    const one = exportUseCase(f, { maxQueuedPerClinic: 1 });
    const first = exportActor(f.other.clinicId, f.other.admin.memberId, ADMIN_KEYS, { all: true });
    const second = exportActor(f.other.clinicId, f.other.receptionist.memberId, ADMIN_KEYS, {
      all: true,
    });
    const queuedBefore = (await exportsOf(f.other.clinicId)).filter(
      (row) => row["status"] === "queued",
    );
    const [left, right] = await Promise.allSettled([
      one.request(first, exportBody("by_doctor")),
      one.request(second, exportBody("by_service")),
    ]);
    const outcomes = [left, right];
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const busy = outcomes.find((item) => item.status === "rejected");
    expect(busy?.status === "rejected" && busy.reason).toMatchObject({
      code: "export_busy",
      status: 429,
    });
    const queuedAfter = (await exportsOf(f.other.clinicId)).filter(
      (row) => row["status"] === "queued",
    );
    expect(queuedAfter).toHaveLength(queuedBefore.length + 1);
    const memberId = f.branch.memberId;
    const member = exportActor(f.C.clinicId, memberId, ADMIN_KEYS, { all: true });
    const baseline = await exportUseCase(f).request(member, exportBody("daily_takings"));
    const runningId = "018f6b6e-7c3a-7000-8000-0000000000aa";
    await f.h.owner`INSERT INTO finance_report_exports
      (clinic_id, id, requested_by, report, params, format, scope, status, attempt, created_at)
      VALUES (${f.C.clinicId}, ${runningId}, ${memberId}, 'refunds',
        '{"from":"2026-01-01","to":"2026-01-02","language":"en","branchIds":[]}'::jsonb,
        'xlsx', 'branch', 'running', 1, ${CLOCK_AT}::timestamptz)`;
    const beforeRows = (await exportsOf(f.C.clinicId)).filter(
      (row) => row["requested_by"] === memberId,
    );
    const beforeEvents = await f.h
      .owner`SELECT count(*)::int AS n FROM outbox_events WHERE clinic_id = ${f.C.clinicId}`;
    await expect(exportUseCase(f).request(member, exportBody("refunds"))).rejects.toMatchObject({
      code: "export_busy",
      status: 429,
    });
    const afterRows = (await exportsOf(f.C.clinicId)).filter(
      (row) => row["requested_by"] === memberId,
    );
    expect(afterRows.map((row) => row["id"])).toEqual(beforeRows.map((row) => row["id"]));
    expect(afterRows.filter((row) => row["status"] === "queued").map((row) => row["id"])).toEqual([
      baseline.export.id,
    ]);
    expect(afterRows.filter((row) => row["status"] === "running")).toHaveLength(1);
    const afterEvents = await f.h
      .owner`SELECT count(*)::int AS n FROM outbox_events WHERE clinic_id = ${f.C.clinicId}`;
    expect(afterEvents).toEqual(beforeEvents);
  });

  it("rolls back the export and the outbox together when the event write fails", async () => {
    const exportId = "018f6b6e-7c3a-7000-8000-0000000000bb";
    const eventId = "018f6b6e-7c3a-7000-8000-0000000000cc";
    const ids = [exportId, eventId];
    let n = 0;
    const useCase = exportUseCase(f, {
      ids: {
        newId: () => {
          const id = ids[n];
          n += 1;
          if (id === undefined) throw new Error("unexpected id");
          return id;
        },
      },
      append: async (tx, event) => {
        await appendOutboxEvent(tx, event);
        throw new Error("forced-outbox-failure");
      },
    });
    await expect(
      useCase.request(
        exportActor(f.C.clinicId, f.C.priceReader.memberId, ADMIN_KEYS, { all: true }),
        exportBody("refunds"),
      ),
    ).rejects.toThrow("forced-outbox-failure");
    expect(await f.h.owner`SELECT id FROM finance_report_exports WHERE id = ${exportId}`).toEqual(
      [],
    );
    expect(await f.h.owner`SELECT id FROM outbox_events WHERE id = ${eventId}`).toEqual([]);
  });

  it("returns requester metadata only, and isolates the other member and clinic", async () => {
    const actor = exportActor(f.C.clinicId, f.C.admin.memberId, ADMIN_KEYS, { all: true });
    const admitted = reportExportResponseSchema.parse(
      await exportUseCase(f).request(
        actor,
        exportBody("outstanding", { format: "xlsx", language: "en" }),
      ),
    );
    const seen = reportExportResponseSchema.parse(
      await exportUseCase(f).status(actor, admitted.export.id),
    );
    expect(seen).toEqual(admitted);
    await expect(
      exportUseCase(f).status(
        exportActor(f.C.clinicId, f.desk.memberId, DESK_KEYS, {
          all: false,
          branchIds: [f.C.branchR],
        }),
        admitted.export.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(exportUseCase(f).status(actor, "not-a-uuid")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      exportUseCase(f).status(actor, "018f6b6e-7c3a-7000-8000-0000000000dd"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      exportUseCase(f).status(
        exportActor(f.other.clinicId, f.other.admin.memberId, ADMIN_KEYS, { all: true }),
        admitted.export.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const hidden = await appDatabase(f).withTenant(f.other.clinicId, (tx) =>
      tx.execute(sql`SELECT id FROM finance_report_exports WHERE id = ${admitted.export.id}`),
    );
    expect(hidden).toEqual([]);
    const leakId = "018f6b6e-7c3a-7000-8000-0000000000ee";
    await expect(
      appDatabase(f).withTenant(f.other.clinicId, (tx) =>
        tx.execute(sql`INSERT INTO finance_report_exports
          (clinic_id, id, requested_by, report, params, format, scope, status, attempt, created_at)
          VALUES (${f.C.clinicId}, ${leakId}, ${f.C.admin.memberId}, 'discounts',
            '{"from":"2026-01-01","to":"2026-01-02","language":"ar","branchIds":[]}'::jsonb,
            'csv', 'clinic', 'queued', 0, ${CLOCK_AT}::timestamptz)`),
      ),
    ).rejects.toThrow();
    expect(await f.h.owner`SELECT id FROM finance_report_exports WHERE id = ${leakId}`).toEqual([]);
    await expect(
      exportUseCase(f).request(actor, { ...exportBody("by_service"), patientId: f.patientD }),
    ).rejects.toMatchObject({
      code: "validation",
    });
  });
});
