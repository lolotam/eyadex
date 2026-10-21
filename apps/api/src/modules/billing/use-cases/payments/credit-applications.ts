import type { CreateCreditApplicationRequest, InvoiceSettlement } from "@eyadex/contracts/finance";
import { creditBalance, planCreditApplication } from "@eyadex/contracts/settlement";
import type { Tx } from "@eyadex/db";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { BillingActor, MemberBranches } from "../../domain/billing-actor.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { paymentsReach } from "../../domain/money-reach.ts";
import { settle } from "../../domain/payment-rules.ts";
import { invoiceOwner, lockInvoice } from "../../persistence/pg-invoice-changes.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import { readPatientMoney } from "../../persistence/pg-patient-money.ts";
import { readAllocations } from "../../persistence/pg-payment-reads.ts";
import { insertAllocation, invoiceMoneyFacts } from "../../persistence/pg-payment-writes.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { moneyClaim } from "./payment-claim.ts";
import type { PaymentDeps } from "./payments.ts";

/** جواب استخدام رصيد: التخصيصات اللي اتكتبت، وحالة الفاتورة، ورصيد المراجع. */
export type CreditApplicationAnswer = {
  readonly allocations: {
    readonly id: string;
    readonly creditId: string;
    readonly amountMinor: string;
    readonly createdAt: string;
  }[];
  readonly settlement: InvoiceSettlement;
  readonly creditBalanceMinor: string;
};

/**
 * استخدام رصيد المراجع على فاتورة (FIN-13، F2-Q6، spec §4.3، §4.4): مفيش إيصال لأن فلوس ما دخلتش،
 * والأرصدة بتتصرف من الأقدم للأحدث (F2-Q18). القفل: المفتاح (0) وبعدين المراجع (7) وبعدين الفاتورة
 * (7a) — من غير فرع ولا درج ولا رقم، والرصيد بيتقرا بعد الأقفال.
 */
export class CreditApplications {
  constructor(private readonly deps: PaymentDeps) {}

  /**
   * بيصرف رصيد المراجع على فاتورة.
   *
   * @param actor الفاعل (شايل `create:payments` بنطاق `clinic` أو `branch`)
   * @param invoiceId الفاتورة
   * @param body المبلغ
   * @param idempotencyKey المفتاح
   * @returns التخصيصات وحالة الفاتورة ورصيد المراجع
   */
  applyCredit(
    actor: BillingActor,
    invoiceId: string,
    body: CreateCreditApplicationRequest,
    idempotencyKey: string,
  ): Promise<CreditApplicationAnswer> {
    const reach = paymentsReach(actor, "create");
    if (reach === null) throw new ApiError("forbidden");
    const claim = moneyClaim(actor, "credit.apply", invoiceId, body, idempotencyKey);
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<{ allocationIds: string[] }>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      // The first answer is given again only while the invoice's branch is still in reach (R3-6).
      if (claimed.kind === "replay") {
        return this.answer(tx, actor, reach, invoiceId, claimed.response.allocationIds);
      }
      const allocationIds = await this.write(tx, actor, reach, invoiceId, body);
      await completeClinicIdempotencyKey(tx, claim, { allocationIds });
      return this.answer(tx, actor, reach, invoiceId, allocationIds);
    });
  }

  /**
   * الكتابة تحت الأقفال: المراجع وبعدين الفاتورة `FOR UPDATE`؛ التخصيصات بتتمويل رصيد، من غير
   * فرع ولا درج ولا رقم (ADR-0027).
   *
   * @returns معرّفات التخصيصات اللي اتكتبت
   */
  private async write(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    invoiceId: string,
    body: CreateCreditApplicationRequest,
  ): Promise<string[]> {
    const { clock, ids, patients } = this.deps;
    const owner = await invoiceOwner(tx, actor.clinicId, invoiceId);
    if (owner === null || !reachesBranch(reach, owner.branchId)) throw new ApiError("not_found");
    if (!(await patients.lockForInvoice(tx, actor.clinicId, owner.patientId))) {
      throw new ApiError("not_found");
    }
    const locked = await lockInvoice(tx, actor.clinicId, invoiceId);
    if (locked === null) throw new ApiError("not_found");
    // Every balance is read after the locks (spec §4.4).
    const money = await readPatientMoney(tx, actor.clinicId, locked.patientId);
    const facts = await invoiceMoneyFacts(tx, actor.clinicId, invoiceId);
    const spends = settle(() =>
      planCreditApplication(
        money,
        { id: invoiceId, status: locked.status, totalMinor: BigInt(facts.totalMinor) },
        BigInt(body.amountMinor),
      ),
    );
    const [first] = spends;
    // The plan spends at least one credit for a positive amount inside the balance; an empty plan
    // would mean the balance changed under the lock, so it is refused as an insufficient balance.
    if (first === undefined) throw new ApiError("credit_insufficient");
    const now = clock.now();
    const allocationIds: string[] = [];
    for (const spend of spends) {
      const allocationId = ids.newId();
      await insertAllocation(tx, actor.clinicId, {
        id: allocationId,
        invoiceId,
        patientId: locked.patientId,
        paymentId: null,
        creditId: spend.creditId,
        amountMinor: String(spend.amountMinor),
        createdBy: actor.membershipId,
        createdAt: now,
      });
      allocationIds.push(allocationId);
    }
    await writeFinanceAudit(tx, {
      clinicId: actor.clinicId,
      id: ids.newId(),
      actorUserId: actor.userId,
      action: "credit.applied",
      entityType: "patient_credit",
      entityId: first.creditId,
      branchId: locked.branchId,
      before: null,
      after: {
        invoiceNumber: facts.number,
        amountMinor: body.amountMinor,
        currency: facts.currency,
        spends: spends.map((spend) => ({
          creditId: spend.creditId,
          amountMinor: String(spend.amountMinor),
        })),
      },
      createdAt: now,
    });
    return allocationIds;
  }

  /**
   * جواب استخدام الرصيد: التخصيصات بتقرا تاني من الداتابيز، وحالة الفاتورة من الدالة المشتركة،
   * ورصيد المراجع بعد الصرف.
   *
   * @returns التخصيصات وحالة الفاتورة ورصيد المراجع
   */
  private async answer(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    invoiceId: string,
    allocationIds: readonly string[],
  ): Promise<CreditApplicationAnswer> {
    const rows = await readAllocations(tx, actor.clinicId, allocationIds);
    const invoice = await readInvoice(tx, actor.clinicId, invoiceId);
    if (invoice === null || !reachesBranch(reach, invoice.branchId))
      throw new ApiError("not_found");
    const settlement = invoice.settlement;
    // A void invoice has no settlement: the credit was applied to an invoice that was voided after it.
    if (settlement === null || settlement === undefined) throw new ApiError("invoice_void");
    const money = await readPatientMoney(tx, actor.clinicId, invoice.patientId);
    return {
      allocations: rows.map((row) => ({
        id: row.id,
        creditId: row.credit_id,
        amountMinor: row.amount_minor,
        createdAt: row.created_at,
      })),
      settlement,
      creditBalanceMinor: String(creditBalance(money)),
    };
  }
}
