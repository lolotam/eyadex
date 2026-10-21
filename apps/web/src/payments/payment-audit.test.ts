import { beforeEach, describe, expect, it } from "vitest";
import { assertFinanceAuditSnapshotShape } from "@eyadex/contracts/finance-audit-snapshot";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  admin,
  api,
  applyCredit,
  auditOf,
  editTotal,
  issue,
  pay,
  refusal,
  voidIt,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());

const check = (entity: "payment" | "patient_credit", after: unknown) =>
  expect(() => assertFinanceAuditSnapshotShape(entity, after as never)).not.toThrow();

describe("payment and credit audit rows (spec §4.6)", () => {
  it("payment.recorded: patient access, the exact snapshot, never the reference", async () => {
    const invoice = await issue("2500000");
    const answer = await api.payments.recordPayment(
      admin(),
      invoice.id,
      { method: "cash", amountMinor: "1234567", reference: "APPROVAL-777" },
      crypto.randomUUID(),
    );
    const [row, ...more] = auditOf("payment.recorded");
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      entity: "payment",
      entityId: answer.payment.id,
      category: "patient_access",
      before: null,
      after: {
        receiptNumber: answer.payment.receiptNumber,
        invoiceNumber: invoice.number,
        method: "cash",
        // Seven digits stay whole: the snapshot skips the phone scrub because its shape is checked.
        amountMinor: "1234567",
        currency: invoice.currency,
        cashSeq: "1",
      },
    });
    expect(JSON.stringify(row)).not.toContain("APPROVAL-777");
    check("payment", row!.after);
  });

  it("credit.released on an edit below what is paid and on a void, after the invoice row", async () => {
    const invoice = await issue("10000");
    await pay(invoice.id, "10000");
    await editTotal(invoice.id, "7000");
    const [edited] = auditOf("credit.released");
    expect(edited).toMatchObject({
      entity: "patient_credit",
      category: "patient_access",
      after: { invoiceNumber: invoice.number, amountMinor: "3000", cause: "invoice_edited" },
    });
    check("patient_credit", edited!.after);
    await voidIt(invoice.id);
    const rows = auditOf("credit.released");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ after: { amountMinor: "7000", cause: "invoice_voided" } });
    // Newest first in the log: the credit row was written after the invoice's own void row.
    const log = (await import("@/shared/api/mock/mock-test-kit")).getState().clinicAudit;
    expect(log.findIndex((e) => e.action === "credit.released")).toBeLessThan(
      log.findIndex((e) => e.action === "invoice.voided"),
    );
  });

  it("credit.applied names the first credit spent and lists the spends", async () => {
    const one = await issue("5000");
    await pay(one.id, "5000");
    await voidIt(one.id);
    const two = await issue("4000");
    await applyCredit(two.id, "4000");
    const [row] = auditOf("credit.applied");
    const credit = auditOf("credit.released")[0]!;
    expect(row).toMatchObject({
      entity: "patient_credit",
      entityId: credit.entityId,
      after: {
        invoiceNumber: two.number,
        amountMinor: "4000",
        spends: [{ creditId: credit.entityId, amountMinor: "4000" }],
      },
    });
    check("patient_credit", row!.after);
  });

  it("NEGATIVE: raising the total writes no credit row and takes no credit back", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "5000");
    await editTotal(invoice.id, "8000");
    expect(auditOf("credit.released")).toEqual([]);
  });

  it("NEGATIVE: a refused payment or credit writes no row", async () => {
    const invoice = await issue("5000");
    await refusal(pay(invoice.id, "9000"));
    await refusal(applyCredit(invoice.id, "100"));
    expect([...auditOf("payment.recorded"), ...auditOf("credit.applied")]).toEqual([]);
  });

  it("listing receipts and invoice movements writes no patient-access row", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "100");
    const log = (await import("@/shared/api/mock/mock-test-kit")).getState().clinicAudit;
    const before = log.length;
    await api.payments.listPayments(admin(), {});
    await api.payments.invoicePayments(admin(), invoice.id);
    expect(log.length).toBe(before);
  });
});
