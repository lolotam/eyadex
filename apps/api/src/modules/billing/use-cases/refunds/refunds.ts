import type { CreateRefundRequest, InvoiceSettlement, Refund } from "@eyadex/contracts/finance";
import {
  creditBalance,
  planCreditRefund,
  type CreditSpend,
  type Release,
} from "@eyadex/contracts/settlement";
import type { Tx } from "@eyadex/db";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor, MemberBranches } from "../../domain/billing-actor.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { refundsReach } from "../../domain/money-reach.ts";
import {
  clinicBusinessDay,
  formatRefundNumber,
  requireMethodEnabled,
  settle,
} from "../../domain/payment-rules.ts";
import { planRefundFromPayment } from "../../domain/refund-rules.ts";
import {
  invoiceOwner,
  lockInvoice,
  type LockedInvoice,
} from "../../persistence/pg-invoice-changes.ts";
import { branchPrefix, readInvoice } from "../../persistence/pg-invoice-store.ts";
import { readPatientMoney } from "../../persistence/pg-patient-money.ts";
import {
  insertCredit,
  invoiceMoneyFacts,
  paymentMethodRows,
  takeCashSeq,
  takeReceiptSeq,
} from "../../persistence/pg-payment-writes.ts";
import {
  insertRefund,
  insertRefundSource,
  paymentForRefund,
} from "../../persistence/pg-refund-writes.ts";
import { moneyClaim } from "../payments/payment-claim.ts";
import type { PaymentDeps } from "../payments/payments.ts";
import { writeRefundAudit, type RefundCredit } from "./refund-audit.ts";
import { refundInReach } from "./refund-view.ts";

/** جواب الاسترداد: سند الصرف، وحالة الفاتورة بعده (`null` لو ملغية)، ورصيد المراجع. */
export type RefundAnswer = {
  readonly refund: Refund;
  readonly settlement: InvoiceSettlement | null;
  readonly creditBalanceMinor: string;
};

/** الرد المحفوظ في مفتاح العيادة: الاسترداد، والحالة والرصيد اللي أول جواب رجّعهم (R3-6). */
interface RefundClaim {
  readonly refundId: string;
  readonly settlement: InvoiceSettlement | null;
  readonly creditBalanceMinor: string;
}

/** خطة الاسترداد: اللي هيتحرر من الدفعة (لو من دفعة) أو اللي هيتصرف من الرصيد، وإيصال الدفعة. */
interface RefundPlan {
  readonly releases: readonly Release[];
  readonly spends: readonly CreditSpend[];
  readonly receiptNumber: string | null;
}

/**
 * الاسترداد من فاتورة (FIN-14، F2-Q4، F2-Q5، F2-Q13، spec §4.3، §4.4): من دفعة على الفاتورة (التخصيص
 * بيتحرر لرصيد والرصيد بيتصرف، والفاتورة ترجع عليها الفلوس) أو من رصيد المراجع (الأقدم الأول). القفل:
 * المفتاح (0) وبعدين المراجع (7) وبعدين الفاتورة (7a) وبعدين فرعها (9) وبعدين درج الكاش (9a، كاش بس)
 * وبعدين سلسلة الاسترداد (9c). كل رصيد بيتقرا بعد الأقفال، ورقم الاسترداد من غير فجوة.
 */
export class InvoiceRefunds {
  constructor(private readonly deps: PaymentDeps) {}

  /**
   * بيسجّل استرداد من فاتورة ويجيب سند الصرف وحالة الفاتورة ورصيد المراجع.
   *
   * @param actor الفاعل (شايل `create:refunds` بنطاق `clinic` أو `branch`)
   * @param invoiceId الفاتورة اللي الاسترداد اتعمل منها
   * @param body المصدر والمبلغ والطريقة والسبب
   * @param idempotencyKey المفتاح
   * @returns الاسترداد وحالة الفاتورة ورصيد المراجع
   */
  record(
    actor: BillingActor,
    invoiceId: string,
    body: CreateRefundRequest,
    idempotencyKey: string,
  ): Promise<RefundAnswer> {
    const reach = refundsReach(actor);
    if (reach === null) throw new ApiError("forbidden");
    const claim = moneyClaim(actor, "refund.create", invoiceId, body, idempotencyKey);
    const { db, clock, ids, patients } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<RefundClaim>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      // The replay answers what the first request answered, not what the invoice looks like now (R3-6),
      // and only while the refund's branch is still in the caller's reach.
      if (claimed.kind === "replay") {
        const { refundId, settlement, creditBalanceMinor } = claimed.response;
        const refund = await refundInReach(tx, patients, actor.clinicId, reach, refundId);
        return { refund, settlement, creditBalanceMinor };
      }
      const refundId = await this.write(tx, actor, reach, invoiceId, body);
      const answer = await this.answer(tx, actor, reach, refundId);
      await completeClinicIdempotencyKey(tx, claim, {
        refundId,
        settlement: answer.settlement,
        creditBalanceMinor: answer.creditBalanceMinor,
      });
      return answer;
    });
  }

  /**
   * الكتابة تحت الأقفال: المراجع، بعدين الفاتورة `FOR UPDATE`، بعدين فرع الفاتورة `FOR SHARE` (لبادئة
   * الرقم)، بعدين درج الكاش (كاش بس)، بعدين سلسلة الاسترداد (ADR-0027).
   *
   * @returns معرّف الاسترداد اللي اتكتب
   */
  private async write(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    invoiceId: string,
    body: CreateRefundRequest,
  ): Promise<string> {
    const { clock, ids, patients } = this.deps;
    const owner = await invoiceOwner(tx, actor.clinicId, invoiceId);
    if (owner === null || !reachesBranch(reach, owner.branchId)) throw new ApiError("not_found");
    if (!(await patients.lockForInvoice(tx, actor.clinicId, owner.patientId))) {
      throw new ApiError("not_found");
    }
    const locked = await lockInvoice(tx, actor.clinicId, invoiceId);
    if (locked === null) throw new ApiError("not_found");
    // F2-Q5: any method the clinic has on, whatever the original payment's method was.
    requireMethodEnabled(await paymentMethodRows(tx, actor.clinicId), body.method);
    // Every balance is read after the locks (spec §4.4); a void invoice still refunds its credit.
    const plan = await this.plan(tx, actor.clinicId, invoiceId, locked, body);
    const facts = await invoiceMoneyFacts(tx, actor.clinicId, invoiceId);
    const prefix = await branchPrefix(tx, actor.clinicId, locked.branchId);
    if (prefix === null) throw new ApiError("invoice_prefix_missing");
    // The clock is read after the patient, the invoice and the branch locks (spec §4.4).
    const now = clock.now();
    const day = clinicBusinessDay(now, facts.timezone);
    const { clinicId } = actor;
    const cashSeq =
      body.method === "cash" ? await takeCashSeq(tx, ids, clinicId, locked.branchId, now) : null;
    const seq = await takeReceiptSeq(tx, ids, clinicId, locked.branchId, "refund", day.year, now);
    const refundId = ids.newId();
    const refundNumber = formatRefundNumber(prefix, day.year, seq);
    // A refund from a payment releases into new credits first; the refund then spends exactly them.
    const released = await this.release(tx, actor, locked, plan.releases, now);
    const spends = body.source === "credit" ? plan.spends : released;
    await insertRefund(tx, clinicId, {
      id: refundId,
      branchId: locked.branchId,
      patientId: locked.patientId,
      invoiceId,
      year: day.year,
      refundSeq: seq,
      refundNumber,
      method: body.method,
      amountMinor: body.amountMinor,
      currency: facts.currency,
      currencyExponent: facts.currencyExponent,
      reason: body.reason,
      refundedAt: now,
      businessDate: day.businessDate,
      cashSeq,
      refundedBy: actor.membershipId,
    });
    for (const spend of spends) {
      await insertRefundSource(tx, clinicId, {
        id: ids.newId(),
        refundId,
        creditId: spend.creditId,
        patientId: locked.patientId,
        amountMinor: String(spend.amountMinor),
        createdAt: now,
      });
    }
    const { receiptNumber } = plan;
    const done = { refundId, refundNumber, body, cashSeq, receiptNumber, released, spends };
    await writeRefundAudit(tx, ids, actor, facts, { ...done, branchId: locked.branchId }, now);
    return refundId;
  }

  /**
   * خطة الاسترداد على فلوس المراجع بعد الأقفال: من دفعة (لازم تبقى دفعة الفاتورة دي) أو من الرصيد.
   *
   * @returns الأرصدة اللي تتحرر أو تتصرف، ورقم إيصال الدفعة لو من دفعة
   */
  private async plan(
    tx: Tx,
    clinicId: string,
    invoiceId: string,
    locked: LockedInvoice,
    body: CreateRefundRequest,
  ): Promise<RefundPlan> {
    const money = await readPatientMoney(tx, clinicId, locked.patientId);
    const amount = BigInt(body.amountMinor);
    if (body.source === "credit") {
      const spends = settle(() => planCreditRefund(money, amount));
      return { releases: [], spends, receiptNumber: null };
    }
    const payment = await paymentForRefund(tx, clinicId, body.paymentId);
    // A payment of another invoice is no payment of this one (ISO-02).
    if (payment === null || payment.invoiceId !== invoiceId) throw new ApiError("not_found");
    const releases = settle(() => planRefundFromPayment(money, payment, amount));
    return { releases, spends: [], receiptNumber: payment.receiptNumber };
  }

  /**
   * بيكتب رصيد لكل release بسبب `refund` (R1-5، F2-Q18): التخصيص الأحدث الأول.
   *
   * @returns الأرصدة اللي اتكتبت، بنفس مبالغ الـ releases
   */
  private async release(
    tx: Tx,
    actor: BillingActor,
    locked: LockedInvoice,
    releases: readonly Release[],
    now: Date,
  ): Promise<RefundCredit[]> {
    const credits: RefundCredit[] = [];
    for (const release of releases) {
      const creditId = this.deps.ids.newId();
      await insertCredit(tx, actor.clinicId, {
        id: creditId,
        patientId: locked.patientId,
        originAllocationId: release.allocationId,
        amountMinor: String(release.amountMinor),
        cause: release.cause,
        createdBy: actor.membershipId,
        createdAt: now,
      });
      credits.push({
        creditId,
        amountMinor: release.amountMinor,
        allocationId: release.allocationId,
      });
    }
    return credits;
  }

  /**
   * جواب الاسترداد: السند باسم المراجع، وحالة الفاتورة (`null` لو ملغية)، ورصيد المراجع بعده.
   *
   * @returns الاسترداد وحالة الفاتورة ورصيد المراجع
   */
  private async answer(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    refundId: string,
  ): Promise<RefundAnswer> {
    const { patients } = this.deps;
    const refund = await refundInReach(tx, patients, actor.clinicId, reach, refundId);
    // The refund was just written from this invoice under its lock, so the invoice is there.
    const invoice = (await readInvoice(tx, actor.clinicId, refund.invoiceId))!;
    const money = await readPatientMoney(tx, actor.clinicId, refund.patientId);
    return {
      refund,
      settlement: invoice.settlement ?? null,
      creditBalanceMinor: String(creditBalance(money)),
    };
  }
}
