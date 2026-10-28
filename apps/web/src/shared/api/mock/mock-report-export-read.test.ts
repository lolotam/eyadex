import { expect, it } from "vitest";
import { REPORT_IDS, REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import { SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import { prepareReportExport } from "./mock-export-cells";
import { artifact } from "./mock-export-fixtures.test-kit";
import { xlsxArtifact, cellValues } from "./mock-export-xlsx.test-kit";
import { readReportExport } from "./mock-report-export-read";
import {
  fixture,
  invoice,
  payment,
  refund,
  credit,
  closing,
  params,
  makeOwn,
  ownContext,
  NOW,
} from "./mock-report-export.test-kit";
import { api, admin } from "./mock-report-test-kit";
import { paymentState } from "./mock-payment-state";

it("all ten live builders yield ordered usable bilingual CSV/XLSX cells and exact figures", async () => {
  const f = fixture();
  f.db.appointments = [];
  f.db.medical.visits = [];
  makeOwn(f, f.patient.id);
  const inv = invoice(f, 1);
  payment(f, 1, inv);
  refund(f, 1, inv);
  credit(f, 1);
  closing(f, 1, "synthetic-private-note");
  for (const language of ["ar", "en"] as const) {
    const branch = language === "ar" ? "فرع أ" : "Branch A";
    const free = language === "ar" ? "بنود حرة" : "Free lines";
    const expected = {
      daily_takings: [["2026-05-10", branch, "cash", "3.000", "1.000", "2.000", "KWD"]],
      period_summary: [
        ["2026-05", branch, "9.000", "1.000", "0.000", "3.000", "1.000", "0.000", "0", "KWD"],
      ],
      by_service: [[free, "1", "1", "9.000", "KWD"]],
      by_doctor: [[f.doctor.fullName, "1", "1", "9.000", "KWD"]],
      outstanding: [
        [
          "INV-1",
          branch,
          "2026-05-10",
          f.patient.fullName,
          "9.000",
          "3.000",
          "6.000",
          "over_90",
          "KWD",
        ],
      ],
      patient_credit: [[f.patient.fullName, "7.000", "2024-01-01", "KWD"]],
      refunds: [
        [
          "REF-1",
          "2026-05-10",
          branch,
          f.patient.fullName,
          "cash",
          "credit",
          "1.000",
          f.member.fullName,
          "synthetic refund",
          "KWD",
        ],
      ],
      discounts: [
        [
          "INV-1",
          "2026-05-10",
          branch,
          f.patient.fullName,
          "invoice",
          "1.000",
          "",
          "synthetic discount",
          "KWD",
        ],
      ],
      cash_closings: [
        [
          "2026-05-10",
          branch,
          "2.000",
          "1.500",
          "-0.500",
          f.member.fullName,
          language === "ar" ? "نعم" : "Yes",
          "KWD",
        ],
      ],
      own_summary: [["2026-05", "9.000", "KWD"]],
    };
    for (const report of REPORT_IDS) {
      const ctx = report === "own_summary" ? ownContext(f) : f.ctx;
      const result = readReportExport(ctx, report, params([f.a.id, f.b.id], { language }), NOW);
      expect(result.ownPatientIds).toStrictEqual(report === "own_summary" ? [f.patient.id] : null);
      for (const cells of result.rows) {
        expect(Object.keys(cells)).toStrictEqual(REPORT_EXPORT_COLUMNS[report].map((c) => c.key));
        expect(Object.keys(cells)).not.toContain("patientId");
        expect(Object.keys(cells)).not.toContain("providerId");
      }
      expect(prepareReportExport({ report, language, rows: result.rows }).ok).toBe(true);
      expect(artifact(report, result.rows, language).records.slice(1)).toStrictEqual(
        expected[report],
      );
      const xlsx = await xlsxArtifact(report, result.rows, language);
      const sheet = xlsx.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      expect(cellValues(sheet).slice(1)).toStrictEqual(expected[report]);
      expect([...xlsx.parts.values()].join("")).not.toContain("synthetic-private-note");
    }
  }
});

it("frozen A/B excludes widened C and other-clinic data; missing B refuses entirely", () => {
  const f = fixture();
  for (const [index, branch] of [f.a, f.b, f.c].entries()) {
    const inv = invoice(f, index + 1, { branchId: branch.id });
    payment(f, index + 1, inv);
  }
  const foreign = f.db.clinics[1];
  if (!foreign) throw new Error("Missing foreign clinic");
  const other = invoice(f, 5, { clinicId: foreign.id });
  payment(f, 5, other);
  const frozen = params([f.a.id, f.b.id], { language: "ar" });
  const result = readReportExport(f.ctx, "outstanding", frozen, NOW);
  expect(result.rows.map((r) => r["invoiceNumber"])).toStrictEqual([
    { kind: "text", value: "INV-2" },
    { kind: "text", value: "INV-1" },
  ]);
  expect(result.rows.map((r) => r["branchName"])).toStrictEqual([
    { kind: "text", value: "فرع ب" },
    { kind: "text", value: "فرع أ" },
  ]);
  expect(() =>
    readReportExport({ ...f.ctx, branchIds: [f.a.id, f.c.id] }, "outstanding", frozen, NOW),
  ).toThrow(expect.objectContaining({ code: "forbidden" }));
  f.db.branches = f.db.branches.filter((b) => b.id !== f.b.id);
  expect(() => readReportExport(f.ctx, "outstanding", frozen, NOW)).toThrow(
    expect.objectContaining({ code: "forbidden" }),
  );
});

it.each(["2024-12-30", "2023-01-01"])(
  "internal export reads long range from %s while screen refuses",
  async (from) => {
    const f = fixture();
    invoice(f, 1, { issuedAt: `${from}T12:00:00.000Z` });
    const p = params([f.a.id], { from, to: "2025-12-31" });
    expect(readReportExport(f.ctx, "outstanding", p, NOW).rows[0]?.["invoiceNumber"]).toStrictEqual(
      { kind: "text", value: "INV-1" },
    );
    await expect(
      api.reports.outstanding(admin(), { from: p.from, to: p.to }),
    ).rejects.toMatchObject({ code: "report_range_too_long" });
  },
);

it("frozen grouping overrides screen defaults and names use current branch data in request language", () => {
  const f = fixture();
  const first = invoice(f, 1);
  payment(f, 1, first);
  const second = invoice(f, 2, { issuedAt: "2026-05-11T12:00:00.000Z" });
  payment(f, 2, second);
  const p = params([f.a.id], { groupBy: "month", language: "ar" });
  f.a.nameAr = "اسم جديد";
  const rows = readReportExport(f.ctx, "daily_takings", p, NOW).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.["period"]).toStrictEqual({ kind: "date", value: "2026-05" });
  expect(rows[0]?.["inMinor"]).toStrictEqual({ kind: "money", minor: "6000", exponent: 3 });
  expect(rows[0]?.["branchName"]).toStrictEqual({ kind: "text", value: "اسم جديد" });
  expect(
    readReportExport(f.ctx, "period_summary", params([f.a.id], { groupBy: "day" }), NOW).rows,
  ).toHaveLength(2);
});

it("each row's validated currency sets its exponent rather than the clinic's currency", () => {
  const f = fixture();
  for (const [index, currency] of (["KWD", "SAR", "AED", "BHD", "OMR", "QAR"] as const).entries())
    invoice(f, index + 1, { currency, currencyExponent: SUPPORTED_CURRENCIES[currency] });
  const result = readReportExport(f.ctx, "outstanding", params([f.a.id]), NOW);
  expect(
    artifact("outstanding", result.rows)
      .records.slice(1)
      .map((r) => [r[4], r[8]]),
  ).toStrictEqual([
    ["90.00", "QAR"],
    ["9.000", "OMR"],
    ["9.000", "BHD"],
    ["90.00", "AED"],
    ["90.00", "SAR"],
    ["9.000", "KWD"],
  ]);
});

it("R6 remains current clinic-wide credit regardless of dates/branches and accounts for later spend", () => {
  const f = fixture();
  const inv = invoice(f, 1, { branchId: f.c.id });
  const saved = credit(f, 1);
  paymentState(f.db).allocations.push({
    id: "synthetic-allocation",
    clinicId: f.ctx.clinicId,
    invoiceId: inv.id,
    patientId: inv.patientId,
    creditId: saved.id,
    paymentId: null,
    amountMinor: "2000",
    createdAt: "2026-10-01T12:00:00.000Z",
    by: f.member.id,
  });
  paymentState(f.db).refundSources.push({
    id: "synthetic-source",
    clinicId: f.ctx.clinicId,
    refundId: "synthetic-refund",
    creditId: saved.id,
    patientId: inv.patientId,
    amountMinor: "500",
  });
  for (const from of ["2023-01-01", "2026-10-01"])
    expect(
      readReportExport(f.ctx, "patient_credit", params([f.b.id], { from, to: from }), NOW).rows,
    ).toStrictEqual([
      {
        patientName: { kind: "text", value: f.patient.fullName },
        balanceMinor: { kind: "money", minor: "4500", exponent: 3 },
        oldestCreditDay: { kind: "date", value: "2024-01-01" },
        currency: { kind: "text", value: "KWD" },
      },
    ]);
});

it("reader writes no audit and observes changed state, nullable staff and note absence", () => {
  const f = fixture();
  const inv = invoice(f, 1);
  refund(f, 1, inv, { refundedBy: "missing-staff" });
  closing(f, 1, null);
  const before = structuredClone(f.db.clinicAudit);
  expect(
    readReportExport(f.ctx, "refunds", params([f.a.id]), NOW).rows[0]?.["refundedByName"],
  ).toStrictEqual({ kind: "text", value: null });
  for (const language of ["ar", "en"] as const)
    expect(
      readReportExport(f.ctx, "cash_closings", params([f.a.id], { language }), NOW).rows[0]?.[
        "notePresent"
      ],
    ).toStrictEqual({ kind: "text", value: language === "ar" ? "لا" : "No" });
  inv.totalMinor = "12000";
  expect(
    readReportExport(f.ctx, "outstanding", params([f.a.id]), NOW).rows[0]?.["owedMinor"],
  ).toStrictEqual({ kind: "money", minor: "12000", exponent: 3 });
  expect(f.db.clinicAudit).toStrictEqual(before);
});

it("rejects unsupported row currency without altering the frozen catalogue", () => {
  const f = fixture();
  const stored = invoice(f, 1);
  Object.defineProperty(stored, "currency", { value: "unsupported", configurable: true });
  expect(() => readReportExport(f.ctx, "outstanding", params([f.a.id]), NOW)).toThrow(
    expect.objectContaining({ code: "export_value_invalid" }),
  );
});
