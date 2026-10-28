import { expect, it, vi } from "vitest";
import { scrubAuditText } from "@eyadex/observability/audit-text";
import { writeClinicAudit } from "./mock-audit";
import { fixture, NOW } from "./mock-report-export.test-kit";

const metadata = () => ({
  report: "outstanding",
  from: "2026-01-01",
  to: "2026-12-31",
  branchIds: ["00000000-0000-4000-8000-123456789012"],
  rowCount: 12,
});

it("F3 exact snapshots preserve dates, UUIDs/counts without name expansion or free-text masking", () => {
  const f = fixture();
  const before = f.db.clinicAudit.length;
  const actorName = "Synthetic actor 123456789012";
  writeClinicAudit(
    f.db,
    {
      clinicId: f.ctx.clinicId,
      actorName,
      action: "finance_report.exported",
      entity: "finance_report_export",
      entityId: "synthetic-export-id",
      before: null,
      after: metadata(),
    },
    NOW,
  );
  expect(f.db.clinicAudit).toHaveLength(before + 1);
  const row = f.db.clinicAudit[0];
  expect(row?.after).toStrictEqual(metadata());
  expect(row?.category).toBe("patient_access");
  expect(row?.createdAt).toBe(NOW.toISOString());
  expect(row?.actorName).toBe(scrubAuditText(actorName));
});

it.each([
  { report: "unknown" },
  { report: null },
  { report: undefined },
  { from: "not-a-date" },
  { to: "2025-01-01" },
  { from: "2020-01-01" },
  { branchIds: ["not-a-uuid"] },
  { rowCount: -1 },
  { rowCount: 0.5 },
  { rowCount: "12" },
  { patientIds: [] },
  { reason: "synthetic-private-marker" },
  { fileKey: "private" },
])("malformed F3 metadata %j fails closed before insertion", (changes) => {
  const f = fixture();
  const original = structuredClone(f.db.clinicAudit);
  expect(() =>
    writeClinicAudit(
      f.db,
      {
        clinicId: f.ctx.clinicId,
        actorName: "Synthetic actor",
        action: "finance_report.exported",
        entity: "finance_report_export",
        entityId: "synthetic-export-id",
        before: null,
        after: { ...metadata(), ...changes },
        exact: true,
      },
      NOW,
    ),
  ).toThrow();
  expect(f.db.clinicAudit).toStrictEqual(original);
});

it("missing F3 metadata and mismatched action/before snapshot never insert administrative exports", () => {
  const f = fixture();
  const original = structuredClone(f.db.clinicAudit);
  for (const [action, before, after] of [
    ["finance_report.exported", null, null],
    ["branch.updated", null, metadata()],
    ["finance_report.exported", metadata(), metadata()],
  ] as const) {
    expect(() =>
      writeClinicAudit(
        f.db,
        {
          clinicId: f.ctx.clinicId,
          actorName: "Synthetic actor",
          action,
          entity: "finance_report_export",
          entityId: "synthetic-export-id",
          before,
          after,
        },
        NOW,
      ),
    ).toThrow();
  }
  expect(f.db.clinicAudit).toStrictEqual(original);
});

it("existing entities retain categories, reference expansion, scrubbing and default-clock insertion", () => {
  const f = fixture();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    for (const entity of [
      "patient",
      "visit",
      "invoice",
      "payment",
      "patient_credit",
      "refund",
      "branch",
      "cash_closing",
    ] as const) {
      writeClinicAudit(f.db, {
        clinicId: f.ctx.clinicId,
        actorName: "Synthetic actor",
        action: `${entity}.updated`,
        entity,
        before: null,
        after: { id: "synthetic-record", branchId: f.a.id, note: "Synthetic 123456789012" },
      });
      const row = f.db.clinicAudit[0];
      expect(row?.category).toBe(
        ["branch", "cash_closing"].includes(entity) ? "administrative" : "patient_access",
      );
      expect(row?.createdAt).toBe(NOW.toISOString());
      expect(row?.after?.["note"]).toBe(scrubAuditText("Synthetic 123456789012"));
      expect(row?.after?.["branchId"]).toStrictEqual({
        id: f.a.id,
        nameAr: f.a.nameAr,
        nameEn: f.a.nameEn,
      });
    }
  } finally {
    vi.useRealTimers();
  }
});
