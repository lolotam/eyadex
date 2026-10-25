import { dayInTimeZone } from "@eyadex/contracts/audit";
import {
  createCreditApplicationRequestSchema,
  createPaymentRequestSchema,
} from "@eyadex/contracts/finance";
import {
  assertFinanceAuditSnapshotShape,
  type CreditAuditSnapshot,
  type PaymentAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import type { Persona } from "@eyadex/contracts/session";
import { creditBalance, planCreditApplication, planPayment } from "@eyadex/contracts/settlement";
import { ApiError, financeError } from "../api-error";
import type { CreditApplication, PaymentWrite } from "../payments-client";
import { writeClinicAudit } from "./mock-audit";
import { clinicMonth, financeState } from "./mock-finance-state";
import { requireIdempotencyKey } from "./mock-idempotency";
import { parse } from "./mock-medical-access";
import { reachableInvoice, rememberReplay, replayOf, requirePayments } from "./mock-payment-access";
import { paymentView } from "./mock-payment-reads";
import {
  methodsOf,
  moneyOf,
  movementTime,
  nextCashSeq,
  paymentState,
  type StoredAllocation,
  type StoredPayment,
} from "./mock-payment-state";
import { settle, settlementInvoice, settlementOf } from "./mock-settlement";
import { newId, type MockState } from "./mock-store";

/**
 * POST /v1/invoices/:id/payments (spec §4.6), refusing in the API's order: guard → body → key → replay →
 * invoice reach → method off → void → settled → above the balance → no prefix. A refused write takes no
 * receipt number and no drawer position.
 */
export function recordPayment(
  db: MockState,
  persona: Persona,
  invoiceId: string,
  raw: unknown,
  key: string,
  now: Date,
): PaymentWrite {
  const a = requirePayments(db, persona, "create");
  const body = parse(createPaymentRequestSchema, raw);
  requireIdempotencyKey(key);
  const replay = { op: "payment" as const, key, invoiceId, body };
  const prior = replayOf<PaymentWrite>(db, a, replay);
  if (prior) return prior;
  const invoice = reachableInvoice(db, a, invoiceId, "create");
  const method = methodsOf(db, a.clinic.id).find((m) => m.method === body.method);
  if (!method?.enabled) throw financeError("payment_method_disabled");
  const money = moneyOf(db, invoice.clinicId, invoice.patientId);
  settle(() => planPayment(money, settlementInvoice(invoice), BigInt(body.amountMinor)));
  const prefix = financeState(db).prefixes[invoice.branchId];
  if (!prefix) throw new ApiError("invoice_prefix_missing");
  const s = paymentState(db);
  const at = movementTime(now);
  const year = clinicMonth(at, a.clinic.timezone).slice(0, 4);
  const counter = `${invoice.branchId}:${year}`;
  const seq = (s.receiptCounters[counter] ?? 0) + 1;
  s.receiptCounters[counter] = seq;
  const payment: StoredPayment = {
    clinicId: a.clinic.id,
    id: newId(),
    receiptNumber: `${prefix}-R-${year}-${String(seq).padStart(6, "0")}`,
    branchId: invoice.branchId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    patientId: invoice.patientId,
    method: body.method,
    amountMinor: body.amountMinor,
    currency: invoice.currency,
    currencyExponent: invoice.currencyExponent,
    reference: body.reference ?? null,
    receivedAt: at,
    businessDate: dayInTimeZone(at, a.clinic.timezone),
    cashSeq: body.method === "cash" ? nextCashSeq(db, a.clinic.id, invoice.branchId) : null,
    receivedBy: a.member.id,
  };
  s.payments.push(payment);
  s.allocations.push(
    allocation(
      invoice,
      payment.id,
      null,
      body.amountMinor,
      at,
      a.member.id,
      payment.businessDate,
    ),
  );
  // The reference and the patient's name stay out: they are typed text (finance-audit-snapshot.ts).
  const snapshot: PaymentAuditSnapshot = {
    receiptNumber: payment.receiptNumber,
    invoiceNumber: payment.invoiceNumber,
    method: payment.method,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    cashSeq: payment.cashSeq,
  };
  assertFinanceAuditSnapshotShape("payment", snapshot);
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action: "payment.recorded",
    entity: "payment",
    entityId: payment.id,
    exact: true,
    before: null,
    after: { ...snapshot },
  });
  const answer: PaymentWrite = {
    payment: paymentView(db, payment),
    settlement: settlementOf(db, invoice)!,
  };
  rememberReplay(db, a, replay, invoice.branchId, answer);
  return answer;
}

function allocation(
  invoice: { clinicId: string; id: string; patientId: string },
  paymentId: string | null,
  creditId: string | null,
  amountMinor: string,
  createdAt: string,
  by: string,
  businessDate: string,
): StoredAllocation {
  return {
    clinicId: invoice.clinicId,
    id: newId(),
    patientId: invoice.patientId,
    invoiceId: invoice.id,
    paymentId,
    creditId,
    amountMinor,
    createdAt,
    businessDate,
    by,
  };
}

/**
 * POST /v1/invoices/:id/credit-applications: guard → body → key → replay → invoice reach → void → settled →
 * above the balance → above the credit. Credits are spent oldest first; no receipt, no money came in.
 */
export function applyCredit(
  db: MockState,
  persona: Persona,
  invoiceId: string,
  raw: unknown,
  key: string,
  now: Date,
): CreditApplication {
  const a = requirePayments(db, persona, "create");
  const body = parse(createCreditApplicationRequestSchema, raw);
  requireIdempotencyKey(key);
  const replay = { op: "credit" as const, key, invoiceId, body };
  const prior = replayOf<CreditApplication>(db, a, replay);
  if (prior) return prior;
  const invoice = reachableInvoice(db, a, invoiceId, "create");
  const money = moneyOf(db, invoice.clinicId, invoice.patientId);
  const spends = settle(() =>
    planCreditApplication(money, settlementInvoice(invoice), BigInt(body.amountMinor)),
  );
  const rows = spends.map((spend) =>
    allocation(
      invoice,
      null,
      spend.creditId,
      String(spend.amountMinor),
      movementTime(now),
      a.member.id,
    ),
  );
  paymentState(db).allocations.push(...rows);
  const snapshot: CreditAuditSnapshot = {
    invoiceNumber: invoice.number,
    amountMinor: body.amountMinor,
    currency: invoice.currency,
    spends: rows.map((r) => ({ creditId: r.creditId!, amountMinor: r.amountMinor })),
  };
  assertFinanceAuditSnapshotShape("patient_credit", snapshot);
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action: "credit.applied",
    entity: "patient_credit",
    entityId: rows[0]!.creditId!,
    exact: true,
    before: null,
    after: { ...snapshot, spends: snapshot.spends!.map((x) => ({ ...x })) },
  });
  const answer: CreditApplication = {
    allocations: rows.map((r) => ({
      id: r.id,
      creditId: r.creditId!,
      amountMinor: r.amountMinor,
      createdAt: r.createdAt,
    })),
    settlement: settlementOf(db, invoice)!,
    creditBalanceMinor: String(creditBalance(moneyOf(db, invoice.clinicId, invoice.patientId))),
  };
  rememberReplay(db, a, replay, invoice.branchId, answer);
  return answer;
}
