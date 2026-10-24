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
import { clinicBusinessDay, settle } from "../../domain/payment-rules.ts";
import { invoiceOwner, lockInvoice } from "../../persistence/pg-invoice-changes.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import { readPatientMoney } from "../../persistence/pg-patient-money.ts";
import { readAllocations, type CreditAllocationRow } from "../../persistence/pg-payment-reads.ts";
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

/** الرد المحفوظ في مفتاح العيادة: التخصيصات، والحالة، والرصيد اللي أول جواب رجّعهم (R3-6). */
interface CreditClaim {
  readonly allocationIds: string[];
  readonly settlement: InvoiceSettlement;
  readonly creditBalanceMinor: string;
}

/** التخصيصات كما بتتجاوب في الـ API: صف التخصيص كما هو في الداتابيز. */
const allocationsOf = (rows: readonly CreditAllocationRow[]) =>
  rows.map((row) => ({
    id: row.id,
    creditId: row.credit_id,
    amountMinor: row.amount_minor,
    createdAt: row.created_at,
  }));

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
      const claimed = await claimClinicIdempotencyKey<CreditClaim>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      // The replay answers what the first request answered, not what the invoice looks like now (R3-6).
      if (claimed.kind === "replay") {
        return this.replay(tx, actor, reach, invoiceId, claimed.response);
      }
      const allocationIds = await this.write(tx, actor, reach, invoiceId, body);
      const answer = await this.answer(tx, actor, reach, invoiceId, allocationIds);
      await completeClinicIdempotencyKey(tx, claim, {
        allocationIds,
        settlement: answer.settlement,
        creditBalanceMinor: answer.creditBalanceMinor,
      });
      return answer;
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
    // The allocation freezes its own business day (EY-10.5): the clinic-timezone day of this moment.
    const businessDate = clinicBusinessDay(now, facts.timezone).businessDate;
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
        businessDate,
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
    // The credit use was just written on an issued invoice under its lock, so the invoice is there and issued.
    const money = await readPatientMoney(tx, actor.clinicId, invoice.patientId);
    return {
      allocations: allocationsOf(rows),
      settlement: invoice.settlement!,
      creditBalanceMinor: String(creditBalance(money)),
    };
  }

  /**
   * إعادة الطلب بالمفتاح نفسه: بترجّع الحالة والرصيد اللي أول جواب رجّعهم، مهما تغيّرت الفاتورة
   * بعدها (R3-6).
   *
   * @returns التخصيصات وحالة الفاتورة ورصيد المراجع زي ما أول جواب رجّعهم
   */
  private async replay(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    invoiceId: string,
    response: CreditClaim,
  ): Promise<CreditApplicationAnswer> {
    const rows = await readAllocations(tx, actor.clinicId, response.allocationIds);
    const invoice = await readInvoice(tx, actor.clinicId, invoiceId);
    if (invoice === null || !reachesBranch(reach, invoice.branchId))
      throw new ApiError("not_found");
    return {
      allocations: allocationsOf(rows),
      settlement: response.settlement,
      creditBalanceMinor: response.creditBalanceMinor,
    };
  }
}
