import { beforeEach, describe, expect, it } from "vitest";
import type { CreateRefundRequest, PaymentMethod } from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { assertFinanceAuditSnapshotShape } from "@eyadex/contracts/finance-audit-snapshot";
import { financeState } from "@/shared/api/mock/mock-finance-state";
import { paymentState } from "@/shared/api/mock/mock-payment-state";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  admin,
  api,
  applyCredit,
  as,
  auditOf,
  breachesOf,
  clinicIdAt,
  editTotal,
  getState,
  issue,
  patientAt,
  pay,
  refusal,
  voidIt,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());

const UNKNOWN = "00000000-0000-7000-8000-0000000000ff";
const REASON = "خطأ في التحصيل";

const fromPayment = (paymentId: string, amountMinor: string, method: PaymentMethod = "cash") =>
  ({ source: "payment", paymentId, amountMinor, method, reason: REASON }) as const;
const fromCredit = (amountMinor: string, method: PaymentMethod = "bank_transfer") =>
  ({ source: "credit", amountMinor, method, reason: REASON }) as const;
const refund = (
  invoiceId: string,
  body: CreateRefundRequest,
  persona: Persona = admin(),
  key: string = crypto.randomUUID(),
) => api.payments.refund(persona, invoiceId, body, key);
const settlementOf = async (id: string) => (await api.finance.getInvoice(admin(), id)).settlement;
const creditOf = async (id: string) =>
  (await api.payments.invoicePayments(admin(), id)).creditBalanceMinor;

/** S1–S6 of spec §4.3 on one patient: I1 9000 paid 7000 (P1 cash 4000, P2 KNET 3000 live), credit 3000. */
async function throughS6() {
  const patient = patientAt();
  const i1 = await issue("10000", patient);
  const p1 = (await pay(i1.id, "4000", "cash")).payment;
  await pay(i1.id, "6000", "knet");
  await editTotal(i1.id, "7000");
  await editTotal(i1.id, "9000");
  const i2 = await issue("5000", patient);
  await applyCredit(i2.id, "3000");
  await voidIt(i2.id);
  return { patient, i1, i2, p1 };
}

describe("refund worked examples S7, S8, S10 (spec §4.3)", () => {
  it("S7 credit 3000 → 0, S8 P1 refund reopens I1, S10 refuses above P1's live amount", async () => {
    const { patient, i1, i2, p1 } = await throughS6();
    const s7 = await refund(i2.id, fromCredit("3000"));
    expect(s7.creditBalanceMinor).toBe("0");
    expect(s7.settlement).toBeNull();
    expect(breachesOf(patient.id), "S7").toEqual([]);

    const s8 = await refund(i1.id, fromPayment(p1.id, "1000"));
    expect(s8.settlement).toEqual({ state: "partly_paid", paidMinor: "6000", owedMinor: "3000" });
    expect(s8.creditBalanceMinor).toBe("0");
    const released = auditOf("credit.released").filter((e) => e.after?.["cause"] === "refund");
    expect(released).toHaveLength(1);
    expect(released[0]!.after).toMatchObject({ amountMinor: "1000" });
    expect(breachesOf(patient.id), "S8").toEqual([]);

    expect(await refusal(refund(i1.id, fromPayment(p1.id, "4000")))).toBe(
      "refund_exceeds_available",
    );
    expect(await settlementOf(i1.id)).toEqual(s8.settlement);
    expect(breachesOf(patient.id), "S10").toEqual([]);
  });

  it("a void invoice refunds the credit its void released, not the payment", async () => {
    const i = await issue("5000");
    const p = (await pay(i.id, "5000", "knet")).payment;
    await voidIt(i.id);
    expect(await refusal(refund(i.id, fromPayment(p.id, "1")))).toBe("refund_exceeds_available");
    const done = await refund(i.id, fromCredit("5000"));
    expect(done.creditBalanceMinor).toBe("0");
    expect(await creditOf(i.id)).toBe("0");
    expect(await refusal(refund(i.id, fromCredit("1")))).toBe("credit_insufficient");
  });
});

describe("refund numbers and the drawer", () => {
  it("numbers refunds gap-free in their own series; a refused one takes no number", async () => {
    const i = await issue("10000");
    const p = (await pay(i.id, "10000", "cash")).payment;
    const first = await refund(i.id, fromPayment(p.id, "1000"));
    await refusal(refund(i.id, fromPayment(p.id, "99999")));
    const second = await refund(i.id, fromPayment(p.id, "1000", "knet"));
    expect(first.refund.refundNumber).toMatch(/-RF-\d{4}-000001$/);
    expect(second.refund.refundNumber).toMatch(/-RF-\d{4}-000002$/);
    expect(p.receiptNumber).toMatch(/-R-\d{4}-\d{6}$/);
    // A cash refund takes the next position of the same branch drawer as the cash payment.
    expect(BigInt(first.refund.cashSeq!)).toBe(BigInt(p.cashSeq!) + 1n);
    expect(second.refund.cashSeq).toBeNull();
  });
});

describe("refund refusals in the API's order", () => {
  it("forbidden without create:refunds, before the body is read", async () => {
    expect(await refusal(api.payments.refund(as("receptionist"), UNKNOWN, {} as never, ""))).toBe(
      "forbidden",
    );
  });

  it("not_found for an unknown invoice before a disabled method", async () => {
    paymentState(getState()).methods[clinicIdAt(0)] = { cash: false };
    expect(await refusal(refund(UNKNOWN, fromCredit("1", "cash")))).toBe("not_found");
  });

  it("payment_method_disabled before the amount is judged", async () => {
    const i = await issue("1000");
    paymentState(getState()).methods[clinicIdAt(0)] = { cash: false };
    expect(await refusal(refund(i.id, fromCredit("999999", "cash")))).toBe(
      "payment_method_disabled",
    );
  });

  it("a payment of another invoice is not_found", async () => {
    const a = await issue("1000");
    const b = await issue("1000");
    const p = (await pay(a.id, "1000")).payment;
    expect(await refusal(refund(b.id, fromPayment(p.id, "1")))).toBe("not_found");
  });

  it("the amount before a missing prefix", async () => {
    const i = await issue("1000");
    delete financeState(getState()).prefixes[i.branchId];
    expect(await refusal(refund(i.id, fromCredit("1")))).toBe("credit_insufficient");
  });
});

describe("refund idempotency and audit", () => {
  it("replays the same key and body, refuses the same key with another body", async () => {
    const i = await issue("2000");
    const p = (await pay(i.id, "2000")).payment;
    const key = crypto.randomUUID();
    const once = await refund(i.id, fromPayment(p.id, "500"), admin(), key);
    const again = await refund(i.id, fromPayment(p.id, "500"), admin(), key);
    expect(again.refund.id).toBe(once.refund.id);
    expect(paymentState(getState()).refunds).toHaveLength(1);
    expect(await refusal(refund(i.id, fromPayment(p.id, "600"), admin(), key))).toBe(
      "idempotency_conflict",
    );
  });

  it("writes refund.recorded with the reason's length only", async () => {
    const i = await issue("2000");
    const p = (await pay(i.id, "2000")).payment;
    await refund(i.id, fromPayment(p.id, "500"));
    const [row] = auditOf("refund.recorded");
    expect(row?.entity).toBe("refund");
    expect(row?.after).toMatchObject({ source: "payment", reasonLength: REASON.length });
    expect(JSON.stringify(row)).not.toContain(REASON);
    expect(() => assertFinanceAuditSnapshotShape("refund", row!.after as never)).not.toThrow();
  });

  it("shows the refund on the invoice's movements and in the refunds list", async () => {
    const i = await issue("2000");
    const p = (await pay(i.id, "2000")).payment;
    const done = await refund(i.id, fromPayment(p.id, "500"));
    const view = await api.payments.invoicePayments(admin(), i.id);
    expect(view.movements.at(-1)).toMatchObject({ kind: "refund", reason: REASON });
    expect(view.movements.find((m) => m.kind === "payment")).toMatchObject({
      refundableMinor: "1500",
    });
    const list = await api.payments.listRefunds(admin(), {});
    expect(list.items.map((r) => r.id)).toEqual([done.refund.id]);
    expect(await api.payments.getRefund(admin(), done.refund.id)).toMatchObject({
      patientName: done.refund.patientName,
    });
  });
});
