import { expect, it } from "vitest";
import { artifact } from "./mock-export-fixtures.test-kit";
import { xlsxArtifact, cellValues } from "./mock-export-xlsx.test-kit";
import { readReportExport } from "./mock-report-export-read";
import {
  fixture,
  invoice,
  refund,
  credit,
  params,
  id,
  makeOwn,
  ownContext,
  NOW,
} from "./mock-report-export.test-kit";
import { outstanding, patientCredit } from "./mock-report-balances";
import { refunds, discounts } from "./mock-report-adjustments";
import { ownSummary } from "./mock-report-analytics";
import { isOwnPatient } from "./mock-own-scope";
import { financeState } from "./mock-finance-state";

it.each(["outstanding", "patient_credit", "refunds", "discounts"] as const)(
  "real pagination continuation exports all 205 %s rows once in stable order",
  async (report) => {
    const f = fixture();
    const patient = f.patient;
    const identifiers: string[] = [];
    for (let index = 1; index <= 205; index += 1) {
      if (report === "patient_credit") {
        const p = { ...patient, id: id(100000 + index), fullName: `Synthetic patient ${index}` };
        f.db.patients.push(p);
        credit(f, index, p.id);
        identifiers.push(p.id);
      } else {
        const inv = invoice(f, index);
        if (report === "refunds") identifiers.push(refund(f, index, inv).id);
        else identifiers.push(inv.id);
      }
    }
    // Foreign and frozen-out rows must not pollute total/order; R6 intentionally ignores branches.
    const foreign = f.db.clinics[1];
    if (!foreign) throw new Error("Missing clinic");
    const foreignInvoice = invoice(f, 900, { clinicId: foreign.id });
    if (report === "refunds") refund(f, 900, foreignInvoice);
    if (report === "patient_credit") {
      const foreignCredit = credit(f, 900);
      foreignCredit.clinicId = foreign.id;
    } else {
      const cInvoice = invoice(f, 901, { branchId: f.c.id });
      if (report === "refunds") refund(f, 901, cInvoice);
    }
    const p = params([f.a.id, f.b.id]);
    const ctx = { ...f.ctx, branchIds: p.branchIds };
    const first =
      report === "outstanding"
        ? outstanding(ctx, { ...p, limit: 100 }, NOW)
        : report === "patient_credit"
          ? patientCredit(ctx, { ...p, limit: 100 })
          : report === "refunds"
            ? refunds(ctx, { ...p, limit: 100 })
            : discounts(ctx, { ...p, limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.total).toBe(205);
    expect(first.nextCursor).not.toBeNull();
    const result = readReportExport(f.ctx, report, p, NOW);
    expect(result.rows).toHaveLength(205);
    expect(result.ownPatientIds).toBeNull();
    const expectedIds = [...identifiers].sort().reverse();
    const represented = result.rows.map((cells) => {
      const key =
        report === "patient_credit"
          ? "patientName"
          : report === "refunds"
            ? "refundNumber"
            : "invoiceNumber";
      const cell = cells[key];
      if (!cell || cell.kind !== "text") throw new Error("Missing identity display");
      const index = Number(cell.value?.split(" ").at(-1)?.replace("INV-", "").replace("REF-", ""));
      return report === "patient_credit"
        ? id(100000 + index)
        : report === "refunds"
          ? id(40000 + index)
          : id(index);
    });
    expect(represented).toStrictEqual(expectedIds);
    expect(new Set(represented).size).toBe(205);
    expect(represented[0]).toBe(expectedIds[0]);
    expect(represented.at(-1)).toBe(expectedIds.at(-1));
    expect(artifact(report, result.rows).records).toHaveLength(206);
    const xlsx = await xlsxArtifact(report, result.rows);
    expect(xlsx.rowCount).toBe(205);
    const sheet = xlsx.sheets[0];
    if (!sheet) throw new Error("Missing sheet");
    expect(cellValues(sheet)).toHaveLength(206);
  },
);

it("own patient set is exact, deduped and shares actual ownSummary contribution selection", () => {
  const f = fixture();
  f.db.appointments = [];
  f.db.medical.visits = [];
  const base = f.patient;
  const patients = Array.from({ length: 7 }, (_, index) => ({
    ...base,
    id: id(110000 + index),
    fullName: `Synthetic own ${index}`,
  }));
  f.db.patients.push(...patients);
  const [one, two, cancelled, unreachable, reachedOnly, otherProvider, excluded] = patients;
  if (!one || !two || !cancelled || !unreachable || !reachedOnly || !otherProvider || !excluded)
    throw new Error("Missing fixtures");
  for (const p of [one, reachedOnly, otherProvider, excluded]) makeOwn(f, p.id);
  makeOwn(f, cancelled.id, true);
  f.db.medical.visits.push({
    id: id(120000),
    clinicId: f.ctx.clinicId,
    branchId: f.a.id,
    patientId: two.id,
    providerMembershipId: f.doctor.id,
    appointmentId: null,
    status: "cancelled",
    startedAt: "2026-05-01T12:00:00.000Z",
    signedAt: null,
    cancelReason: null,
    cancelNote: null,
    note: { complaint: null, examination: null, assessment: null, plan: null },
    diagnoses: [],
    prescription: [],
    addenda: [],
  });
  const first = invoice(f, 1, { patientId: one.id });
  first.lines.push({
    ...first.lines[0],
    position: 1,
    kind: "free",
    serviceId: null,
    providerId: f.doctor.id,
    descriptionAr: "بند",
    descriptionEn: "Line",
    quantity: 1,
    unitPriceMinor: "1000",
    lineTotalMinor: "1000",
    discount: null,
  });
  invoice(f, 2, { patientId: one.id, branchId: f.b.id, issuedAt: "2026-06-01T12:00:00.000Z" });
  invoice(f, 3, { patientId: two.id });
  invoice(f, 4, { patientId: cancelled.id });
  invoice(f, 5, { patientId: unreachable.id });
  const notMyLine = invoice(f, 6, { patientId: otherProvider.id });
  notMyLine.lines = notMyLine.lines.map((line) => ({ ...line, providerId: f.member.id }));
  invoice(f, 7, { patientId: excluded.id, status: "void" });
  invoice(f, 8, { patientId: excluded.id, issuedAt: "2025-01-01T12:00:00.000Z" });
  invoice(f, 9, { patientId: excluded.id, branchId: f.c.id });
  const foreign = f.db.clinics[1];
  if (!foreign) throw new Error("Missing foreign clinic");
  invoice(f, 10, { patientId: excluded.id, clinicId: foreign.id });
  expect(isOwnPatient(f.db, f.ctx.clinicId, f.doctor.id, reachedOnly.id)).toBe(true);
  expect(isOwnPatient(f.db, f.ctx.clinicId, f.doctor.id, cancelled.id)).toBe(false);
  const ctx = ownContext(f);
  const p = params([f.a.id, f.b.id]);
  const result = readReportExport(ctx, "own_summary", p, NOW);
  expect(result.ownPatientIds).toStrictEqual([one.id, two.id]);
  expect(artifact("own_summary", result.rows).records.slice(1)).toStrictEqual([
    ["2026-05", "19.000", "KWD"],
    ["2026-06", "9.000", "KWD"],
  ]);
  const actual = ownSummary({ ...ctx, branchIds: p.branchIds }, p);
  expect(actual.totals.billedMinor).toBe("28000");
  expect(result.rows.map((r) => r["billedMinor"])).toStrictEqual(
    actual.rows.map((r) => ({ kind: "money", minor: r.billedMinor, exponent: 3 })),
  );
  expect(JSON.stringify(result.rows)).not.toContain(one.id);
  expect(JSON.stringify(result.rows)).not.toContain(two.id);
  // Losing current own reach affects both the internal set and the unchanged public builder.
  f.db.appointments = [];
  expect(readReportExport(ctx, "own_summary", p, NOW).ownPatientIds).toStrictEqual([two.id]);
  expect(ownSummary({ ...ctx, branchIds: p.branchIds }, p).totals.billedMinor).toBe("9000");
  expect(financeState(f.db).invoices).toHaveLength(10);
});
