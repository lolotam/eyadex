import { dayInTimeZone } from "@eyadex/contracts/audit";
import { createRefundRequestSchema, type CreateRefundRequest } from "@eyadex/contracts/finance";
import {
  assertFinanceAuditSnapshotShape,
  type CreditAuditSnapshot,
  type RefundAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import type { Persona } from "@eyadex/contracts/session";
import {
  creditBalance,
  planCreditRefund,
  planPaymentRefund,
  type CreditSpend,
} from "@eyadex/contracts/settlement";
import { ApiError, financeError } from "../api-error";
import type { RefundWrite } from "../payments-client";
import { writeClinicAudit } from "./mock-audit";
import type { FinanceAccess } from "./mock-finance-access";
import { clinicMonth, financeState, type StoredInvoice } from "./mock-finance-state";
import { requireIdempotencyKey } from "./mock-idempotency";
import { parse } from "./mock-medical-access";
import { refundsReach, rememberReplay, replayOf, requireRefunds } from "./mock-payment-access";
import {
  methodsOf,
  moneyOf,
  movementTime,
  nextCashSeq,
  paymentState,
  type StoredCredit,
  type StoredRefund,
} from "./mock-payment-state";
import { refundView } from "./mock-refund-reads";
import { settle, settlementOf } from "./mock-settlement";
import { newId, type MockState } from "./mock-store";

type Plan = { credits: StoredCredit[]; spends: CreditSpend[]; receiptNumber: string | null };

/**
 * POST /v1/invoices/:id/refunds (spec §4.6), refusing in the API's order: guard → body → key → replay →
 * invoice reach → method off → the plan (payment not_found, refund_exceeds_available, credit_insufficient)
 * → no prefix. A refused refund takes no number and no drawer position.
 */
export function recordRefund(
  db: MockState,
  persona: Persona,
  invoiceId: string,
  raw: unknown,
  key: string,
  now: Date,
): RefundWrite {
  const a = requireRefunds(db, persona);
  const body = parse(createRefundRequestSchema, raw);
  requireIdempotencyKey(key);
  const replay = { op: "refund" as const, key, invoiceId, body };
  const prior = replayOf<RefundWrite>(db, a, replay);
  if (prior) return prior;
  const invoice = financeState(db).invoices.find(
    (i) => i.id === invoiceId && i.clinicId === a.clinic.id,
  );
  if (!invoice || !refundsReach(a, invoice.branchId)) throw new ApiError("not_found");
  // F2-Q5: any method the clinic has on, whatever the original payment's method was.
  const method = methodsOf(db, a.clinic.id).find((m) => m.method === body.method);
  if (!method?.enabled) throw financeError("payment_method_disabled");
  const at = movementTime(now);
  const plan = planOf(db, a, invoice, body, at);
  const prefix = financeState(db).prefixes[invoice.branchId];
  if (!prefix) throw new ApiError("invoice_prefix_missing");
  const s = paymentState(db);
  const cashSeq = body.method === "cash" ? nextCashSeq(db, a.clinic.id, invoice.branchId) : null;
  const year = clinicMonth(at, a.clinic.timezone).slice(0, 4);
  const counter = `${invoice.branchId}:${year}`;
  const seq = (s.refundCounters[counter] ?? 0) + 1;
  s.refundCounters[counter] = seq;
  const refund: StoredRefund = {
    clinicId: a.clinic.id,
    id: newId(),
    refundNumber: `${prefix}-RF-${year}-${String(seq).padStart(6, "0")}`,
    branchId: invoice.branchId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    patientId: invoice.patientId,
    method: body.method,
    amountMinor: body.amountMinor,
    currency: invoice.currency,
    currencyExponent: invoice.currencyExponent,
    reason: body.reason,
    refundedAt: at,
    businessDate: dayInTimeZone(at, a.clinic.timezone),
    cashSeq,
    refundedBy: a.member.id,
  };
  // A refund from a payment releases into new credits first; the refund then spends exactly them.
  s.credits.push(...plan.credits);
  const spends = body.source === "credit" ? plan.spends : plan.credits.map(spendOf);
  s.refunds.push(refund);
  s.refundSources.push(
    ...spends.map((sp) => ({
      clinicId: a.clinic.id,
      id: newId(),
      refundId: refund.id,
      creditId: sp.creditId,
      patientId: invoice.patientId,
      amountMinor: String(sp.amountMinor),
    })),
  );
  writeAudit(db, a, invoice, refund, body, plan, spends);
  const answer: RefundWrite = {
    refund: refundView(db, refund),
    settlement: settlementOf(db, invoice),
    creditBalanceMinor: String(creditBalance(moneyOf(db, invoice.clinicId, invoice.patientId))),
  };
  rememberReplay(db, a, replay, invoice.branchId, answer);
  return answer;
}

const spendOf = (c: StoredCredit): CreditSpend => ({
  creditId: c.id,
  amountMinor: BigInt(c.amountMinor),
});

/** The shared settlement plan, read after the invoice is known (spec §4.4). */
function planOf(
  db: MockState,
  a: FinanceAccess,
  invoice: StoredInvoice,
  body: CreateRefundRequest,
  at: string,
): Plan {
  const money = moneyOf(db, invoice.clinicId, invoice.patientId);
  const amount = BigInt(body.amountMinor);
  if (body.source === "credit") {
    return { credits: [], spends: settle(() => planCreditRefund(money, amount)), receiptNumber: null };
  }
  const payment = paymentState(db).payments.find(
    (p) => p.clinicId === a.clinic.id && p.id === body.paymentId,
  );
  // A payment of another invoice is no payment of this one (ISO-02).
  if (!payment || payment.invoiceId !== invoice.id) throw new ApiError("not_found");
  const releases = settle(() => planPaymentRefund(money, invoice.id, payment.id, amount));
  const credits = releases.map((r) => ({
    clinicId: invoice.clinicId,
    id: newId(),
    patientId: invoice.patientId,
    originAllocationId: r.allocationId,
    amountMinor: String(r.amountMinor),
    cause: r.cause,
    createdAt: at,
    by: a.member.id,
  }));
  return { credits, spends: [], receiptNumber: payment.receiptNumber };
}

/** The API's rows (refund-audit.ts): one `credit.released` per release, then `refund.recorded`. */
function writeAudit(
  db: MockState,
  a: FinanceAccess,
  invoice: StoredInvoice,
  refund: StoredRefund,
  body: CreateRefundRequest,
  plan: Plan,
  spends: CreditSpend[],
): void {
  const base = { clinicId: a.clinic.id, actorName: a.actorName, exact: true, before: null };
  for (const credit of plan.credits) {
    const after: CreditAuditSnapshot = {
      invoiceNumber: invoice.number,
      amountMinor: credit.amountMinor,
      currency: invoice.currency,
      cause: "refund",
      allocationId: credit.originAllocationId,
    };
    assertFinanceAuditSnapshotShape("patient_credit", after);
    writeClinicAudit(db, {
      ...base,
      action: "credit.released",
      entity: "patient_credit",
      entityId: credit.id,
      after: { ...after },
    });
  }
  // The reason is typed text: only its length goes in (F2-Q13).
  const after: RefundAuditSnapshot = {
    refundNumber: refund.refundNumber,
    invoiceNumber: invoice.number,
    method: body.method,
    amountMinor: body.amountMinor,
    currency: invoice.currency,
    cashSeq: refund.cashSeq,
    source: body.source,
    ...(plan.receiptNumber === null ? {} : { receiptNumber: plan.receiptNumber }),
    spends: spends.map((sp) => ({ creditId: sp.creditId, amountMinor: String(sp.amountMinor) })),
    reasonLength: body.reason.length,
  };
  assertFinanceAuditSnapshotShape("refund", after);
  writeClinicAudit(db, {
    ...base,
    action: "refund.recorded",
    entity: "refund",
    entityId: refund.id,
    after: { ...after, spends: after.spends.map((x) => ({ ...x })) },
  });
}
