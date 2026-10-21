import type { CreatePaymentRequest, InvoiceSettlement, Payment } from "@eyadex/contracts/finance";
import { planPayment } from "@eyadex/contracts/settlement";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor, MemberBranches } from "../../domain/billing-actor.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { paymentsReach } from "../../domain/money-reach.ts";
import {
  clinicBusinessDay,
  formatReceiptNumber,
  requireMethodEnabled,
  settle,
} from "../../domain/payment-rules.ts";
import { invoiceOwner, lockInvoice } from "../../persistence/pg-invoice-changes.ts";
import { branchPrefix, readInvoice } from "../../persistence/pg-invoice-store.ts";
import { readPatientMoney } from "../../persistence/pg-patient-money.ts";
import { readPayment } from "../../persistence/pg-payment-reads.ts";
import {
  insertAllocation,
  insertPayment,
  invoiceMoneyFacts,
  paymentMethodRows,
  takeCashSeq,
  takeReceiptSeq,
} from "../../persistence/pg-payment-writes.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { moneyClaim } from "./payment-claim.ts";

export interface PaymentDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly patients: BillingPatientReader;
}

/** جواب تسجيل دفعة: الإيصال وحالة الفاتورة بعده. */
export type PaymentAnswer = {
  readonly payment: Payment;
  readonly settlement: InvoiceSettlement;
};

/**
 * تسجيل دفعة على فاتورة (spec §4.3، §4.4، §4.6): قفل المفتاح (0) وبعدين المراجع (7) وبعدين الفاتورة
 * (7a) وبعدين فرع الفاتورة (9) وبعدين درج الكاش (9a، كاش بس) وبعدين تسلسل الإيصالات (9c). كل رصيد
 * بيتقرا بعد الأقفال، والإيصال بياخد رقم الفرع والسنة من غير فجوة، والدفعة بتعمل تخصيص واحد بكامل
 * المبلغ (F2-Q1)، وصف سجل واحد (بدون مرجع ولا اسم مراجع).
 */
export class InvoicePayments {
  constructor(private readonly deps: PaymentDeps) {}

  /**
   * يسجّل دفعة على فاتورة ويجيب الإيصال وحالة الفاتورة.
   *
   * @param actor الفاعل (شايل `create:payments` بنطاق `clinic` أو `branch`)
   * @param invoiceId الفاتورة
   * @param body طريقة الدفع والمبلغ والمرجع
   * @param idempotencyKey المفتاح
   * @returns الإيصال وحالة الفاتورة
   */
  record(
    actor: BillingActor,
    invoiceId: string,
    body: CreatePaymentRequest,
    idempotencyKey: string,
  ): Promise<PaymentAnswer> {
    const reach = paymentsReach(actor, "create");
    if (reach === null) throw new ApiError("forbidden");
    const claim = moneyClaim(actor, "payment.create", invoiceId, body, idempotencyKey);
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<{ paymentId: string }>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      // The first answer is given again only while its branch is still in the caller's reach (R3-6).
      if (claimed.kind === "replay") {
        return this.answer(tx, actor, reach, claimed.response.paymentId);
      }
      const paymentId = await this.write(tx, actor, reach, invoiceId, body);
      await completeClinicIdempotencyKey(tx, claim, { paymentId });
      return this.answer(tx, actor, reach, paymentId);
    });
  }

  /**
   * الكتابة تحت الأقفال: المراجع، بعدين الفاتورة `FOR UPDATE`، بعدين فرع الفاتورة `FOR SHARE`
   * (لبادئة الإيصال)، بعدين درج الكاش (كاش بس)، بعدين تسلسل الإيصالات (ADR-0027).
   *
   * @returns معرّف الإيصال اللي اتكتب
   */
  private async write(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    invoiceId: string,
    body: CreatePaymentRequest,
  ): Promise<string> {
    const { clock, ids, patients } = this.deps;
    const owner = await invoiceOwner(tx, actor.clinicId, invoiceId);
    if (owner === null || !reachesBranch(reach, owner.branchId)) throw new ApiError("not_found");
    if (!(await patients.lockForInvoice(tx, actor.clinicId, owner.patientId))) {
      throw new ApiError("not_found");
    }
    const locked = await lockInvoice(tx, actor.clinicId, invoiceId);
    if (locked === null) throw new ApiError("not_found");
    requireMethodEnabled(await paymentMethodRows(tx, actor.clinicId), body.method);
    // Every balance is read after the locks (spec §4.4).
    const money = await readPatientMoney(tx, actor.clinicId, locked.patientId);
    const facts = await invoiceMoneyFacts(tx, actor.clinicId, invoiceId);
    settle(() =>
      planPayment(
        money,
        { id: invoiceId, status: locked.status, totalMinor: BigInt(facts.totalMinor) },
        BigInt(body.amountMinor),
      ),
    );
    const prefix = await branchPrefix(tx, actor.clinicId, locked.branchId);
    if (prefix === null) throw new ApiError("invoice_prefix_missing");
    // The clock is read after the patient, the invoice and the branch locks (spec §4.4).
    const now = clock.now();
    const day = clinicBusinessDay(now, facts.timezone);
    const cashSeq =
      body.method === "cash"
        ? await takeCashSeq(tx, ids, actor.clinicId, locked.branchId, now)
        : null;
    const seq = await takeReceiptSeq(
      tx,
      ids,
      actor.clinicId,
      locked.branchId,
      "receipt",
      day.year,
      now,
    );
    const paymentId = ids.newId();
    const receiptNumber = formatReceiptNumber(prefix, day.year, seq);
    await insertPayment(tx, actor.clinicId, {
      id: paymentId,
      branchId: locked.branchId,
      patientId: locked.patientId,
      invoiceId,
      year: day.year,
      receiptSeq: seq,
      receiptNumber,
      method: body.method,
      amountMinor: body.amountMinor,
      currency: facts.currency,
      currencyExponent: facts.currencyExponent,
      reference: body.reference ?? null,
      receivedAt: now,
      businessDate: day.businessDate,
      cashSeq,
      receivedBy: actor.membershipId,
    });
    await insertAllocation(tx, actor.clinicId, {
      id: ids.newId(),
      invoiceId,
      patientId: locked.patientId,
      paymentId,
      creditId: null,
      amountMinor: body.amountMinor,
      createdBy: actor.membershipId,
      createdAt: now,
    });
    await writeFinanceAudit(tx, {
      clinicId: actor.clinicId,
      id: ids.newId(),
      actorUserId: actor.userId,
      action: "payment.recorded",
      entityType: "payment",
      entityId: paymentId,
      branchId: locked.branchId,
      before: null,
      after: {
        receiptNumber,
        invoiceNumber: facts.number,
        method: body.method,
        amountMinor: body.amountMinor,
        currency: facts.currency,
        cashSeq,
      },
      createdAt: now,
    });
    return paymentId;
  }

  /**
   * جواب الدفعة: الإيصال باسم المراجع، وحالة الفاتورة كما تشتقها الدالة المشتركة.
   *
   * @returns الإيصال وحالة الفاتورة
   */
  private async answer(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    paymentId: string,
  ): Promise<PaymentAnswer> {
    const payment = await readPayment(tx, actor.clinicId, paymentId);
    if (payment === null || !reachesBranch(reach, payment.branchId))
      throw new ApiError("not_found");
    const patientName = await this.deps.patients.displayName(tx, actor.clinicId, payment.patientId);
    if (patientName === null) throw new ApiError("not_found");
    const invoice = await readInvoice(tx, actor.clinicId, payment.invoiceId);
    if (invoice === null) throw new ApiError("not_found");
    const settlement = invoice.settlement;
    // A void invoice has no settlement: the payment landed on an invoice that was voided after it.
    if (settlement === null || settlement === undefined) throw new ApiError("invoice_void");
    return { payment: { ...payment, patientName }, settlement };
  }
}
