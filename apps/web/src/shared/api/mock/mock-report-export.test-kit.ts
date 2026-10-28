import type { FrozenReportExportParams } from "@eyadex/contracts/finance-reports";
import { reportByServiceQuerySchema } from "@eyadex/contracts/finance-reports";
import { SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import { financeState, type StoredInvoice } from "./mock-finance-state";
import { paymentState, type StoredPayment, type StoredRefund } from "./mock-payment-state";
import { closingState } from "./mock-cash-closing-state";
import { openReport } from "./mock-report-access";
import { admin, as, getState, memberOf } from "./mock-report-test-kit";
import { resetMockData } from "./mock-test-kit";

export const NOW = new Date("2026-10-28T12:00:00.000Z");
export const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
export const params = (branchIds: readonly string[], changes: Partial<FrozenReportExportParams> = {}): FrozenReportExportParams => ({
  from: "2026-01-01", to: "2026-12-31", language: "en", branchIds, ...changes,
});

export function fixture() {
  resetMockData();
  const db = getState();
  const clinic = db.clinics[0];
  if (!clinic) throw new Error("Missing clinic");
  clinic.timezone = "UTC";
  const branches = db.branches.filter((b) => b.clinicId === clinic.id);
  const a = branches[0]; const b = branches[1];
  const patient = db.patients.find((p) => p.clinicId === clinic.id);
  if (!a || !b || !patient) throw new Error("Missing seed records");
  const c = { ...a, id: id(9000), nameAr: "فرع ج", nameEn: "Branch C" };
  a.nameAr = "فرع أ"; a.nameEn = "Branch A";
  b.nameAr = "فرع ب"; b.nameEn = "Branch B";
  db.branches.push(c);
  const ctx = openReport(db, admin(), "by_service", reportByServiceQuerySchema, { from: "2026-01-01", to: "2026-12-31" }).ctx;
  financeState(db).invoices = [];
  const payments = paymentState(db);
  payments.payments = []; payments.refunds = []; payments.credits = [];
  payments.allocations = []; payments.refundSources = [];
  closingState(db).closings = [];
  return { db, ctx, a, b, c, patient, doctor: memberOf("doctor"), member: memberOf("clinic_admin") };
}

export type Fixture = ReturnType<typeof fixture>;
export function invoice(f: Fixture, number: number, changes: Partial<StoredInvoice> = {}): StoredInvoice {
  const value: StoredInvoice = {
    id: id(number), clinicId: f.ctx.clinicId, number: `INV-${number}`, status: "issued",
    source: "manual", sourceId: null, branchId: f.a.id, patientId: f.patient.id,
    issuedAt: "2026-05-10T12:00:00.000Z", currency: "KWD", currencyExponent: 3,
    subtotalMinor: "10000", discountMinor: "1000", taxRateBp: 0, taxMinor: "0", totalMinor: "9000",
    invoiceDiscount: { kind: "amount", minor: "1000", reason: "synthetic discount" },
    lines: [{ position: 0, kind: "free", serviceId: null, providerId: f.doctor.id,
      descriptionAr: "بند صناعي", descriptionEn: "Synthetic line", quantity: 1,
      unitPriceMinor: "10000", discount: null, lineTotalMinor: "9000" }],
    lineMeta: [{ id: id(10000 + number), discountedBy: null }], discountedBy: null,
    voidReason: null, voidedAt: null, version: 1, ...changes,
  };
  financeState(f.db).invoices.push(value);
  return value;
}

export function payment(f: Fixture, number: number, inv: StoredInvoice, changes: Partial<StoredPayment> = {}) {
  const value: StoredPayment = { id: id(20000 + number), clinicId: inv.clinicId,
    receiptNumber: `PAY-${number}`, branchId: inv.branchId, invoiceId: inv.id, invoiceNumber: inv.number,
    patientId: inv.patientId, method: "cash", amountMinor: "3000", currency: inv.currency,
    currencyExponent: SUPPORTED_CURRENCIES[inv.currency], reference: null,
    receivedAt: inv.issuedAt, businessDate: inv.issuedAt.slice(0, 10), cashSeq: String(number),
    receivedBy: f.member.id, ...changes };
  paymentState(f.db).payments.push(value);
  paymentState(f.db).allocations.push({ id: id(30000 + number), clinicId: inv.clinicId,
    patientId: inv.patientId, invoiceId: inv.id, paymentId: value.id, creditId: null,
    amountMinor: value.amountMinor, createdAt: value.receivedAt, by: f.member.id });
  return value;
}

export function refund(f: Fixture, number: number, inv: StoredInvoice, changes: Partial<StoredRefund> = {}) {
  const value: StoredRefund = { id: id(40000 + number), clinicId: inv.clinicId,
    refundNumber: `REF-${number}`, branchId: inv.branchId, invoiceId: inv.id, invoiceNumber: inv.number,
    patientId: inv.patientId, method: "cash", amountMinor: "1000", currency: inv.currency,
    currencyExponent: SUPPORTED_CURRENCIES[inv.currency], reason: "synthetic refund",
    refundedAt: inv.issuedAt, businessDate: inv.issuedAt.slice(0, 10), cashSeq: String(number),
    refundedBy: f.member.id, ...changes };
  paymentState(f.db).refunds.push(value);
  return value;
}

export function credit(f: Fixture, number: number, patientId = f.patient.id) {
  const value = { id: id(50000 + number), clinicId: f.ctx.clinicId, patientId,
    originAllocationId: id(60000 + number), amountMinor: "7000", cause: "void" as const,
    createdAt: "2024-01-01T12:00:00.000Z", by: f.member.id };
  paymentState(f.db).credits.push(value);
  return value;
}

export function closing(f: Fixture, number: number, note: string | null) {
  closingState(f.db).closings.push({ id: id(70000 + number), clinicId: f.ctx.clinicId,
    branchId: f.a.id, businessDate: "2026-05-10", previousClosingId: null,
    fromCashSeq: "0", toCashSeq: "1", expectedMinor: "2000", countedMinor: "1500",
    differenceMinor: "-500", methodTotals: [], note, currency: "KWD", currencyExponent: 3,
    closedBy: f.member.id, closedAt: "2026-05-10T15:00:00.000Z" });
}

export function ownContext(f: Fixture) {
  return openReport(f.db, as("doctor"), "own_summary", reportByServiceQuerySchema,
    { from: "2026-01-01", to: "2026-12-31" }).ctx;
}

export function makeOwn(f: Fixture, patientId: string, cancelled = false) {
  f.db.appointments.push({ id: id(80000 + f.db.appointments.length), clinicId: f.ctx.clinicId,
    branchId: f.a.id, patientId, providerMembershipId: f.doctor.id, serviceId: null,
    startsAt: "2026-05-10T10:00:00.000Z", endsAt: "2026-05-10T11:00:00.000Z",
    status: cancelled ? "cancelled" : "confirmed", overbooked: false,
    cancelReason: null, cancelNote: null, createdAt: "2026-05-01T10:00:00.000Z" });
}