import type { CreateRefundRequest } from "@eyadex/contracts/finance";
import type { CreditSpend } from "@eyadex/contracts/settlement";
import type { Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import type { InvoiceMoneyFacts } from "../../persistence/pg-payment-writes.ts";

/** رصيد اتكتب من release بسبب الاسترداد، مع التخصيص اللي طلع منه. */
export interface RefundCredit extends CreditSpend {
  readonly allocationId: string;
}

/** اللي الاسترداد كتبه، زي ما صفوف السجل بتوصفه. */
export interface WrittenRefund {
  readonly refundId: string;
  readonly refundNumber: string;
  readonly branchId: string;
  readonly body: CreateRefundRequest;
  readonly cashSeq: string | null;
  readonly receiptNumber: string | null;
  readonly released: readonly RefundCredit[];
  readonly spends: readonly CreditSpend[];
}

/**
 * صفوف سجل الاسترداد (spec §4.6): `credit.released` لكل رصيد اتحرر من الدفعة، وصف `refund.recorded`
 * واحد بالأرقام والمبالغ والأرصدة اللي اتصرفت بس؛ السبب طوله بس، عمر النص نفسه ما يتخزن.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param ids مولّد المعرّفات
 * @param actor الفاعل
 * @param facts رقم الفاتورة وعملتها
 * @param done اللي الاسترداد كتبه
 * @param now لحظة الكتابة
 * @returns بيخلص لما الصفوف تتكتب
 */
export async function writeRefundAudit(
  tx: Tx,
  ids: IdGenerator,
  actor: BillingActor,
  facts: InvoiceMoneyFacts,
  done: WrittenRefund,
  now: Date,
): Promise<void> {
  const base = { clinicId: actor.clinicId, actorUserId: actor.userId, branchId: done.branchId };
  for (const credit of done.released) {
    await writeFinanceAudit(tx, {
      ...base,
      id: ids.newId(),
      action: "credit.released",
      entityType: "patient_credit",
      entityId: credit.creditId,
      before: null,
      after: {
        invoiceNumber: facts.number,
        amountMinor: String(credit.amountMinor),
        currency: facts.currency,
        cause: "refund",
        allocationId: credit.allocationId,
      },
      createdAt: now,
    });
  }
  await writeFinanceAudit(tx, {
    ...base,
    id: ids.newId(),
    action: "refund.recorded",
    entityType: "refund",
    entityId: done.refundId,
    before: null,
    after: {
      refundNumber: done.refundNumber,
      invoiceNumber: facts.number,
      method: done.body.method,
      amountMinor: done.body.amountMinor,
      currency: facts.currency,
      cashSeq: done.cashSeq,
      source: done.body.source,
      ...(done.receiptNumber === null ? {} : { receiptNumber: done.receiptNumber }),
      spends: done.spends.map((spend) => ({
        creditId: spend.creditId,
        amountMinor: String(spend.amountMinor),
      })),
    },
    reasonLength: done.body.reason.length,
    createdAt: now,
  });
}
