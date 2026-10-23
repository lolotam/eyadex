import type { Invoice, UpdateInvoiceRequest } from "@eyadex/contracts/finance";
import type { VoidInvoiceRequest as VoidBody } from "@eyadex/contracts/finance";
import {
  planEditRelease,
  planVoidRelease,
  type PatientMoney,
  type Release,
} from "@eyadex/contracts/settlement";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { invoiceAuditSnapshot, writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { branchReach, reachesBranch } from "../../domain/invoice-reach.ts";
import { invoiceTotals, mayDiscount } from "../../domain/invoice-rules.ts";
import { settle } from "../../domain/payment-rules.ts";
import { requireExpectedPaid } from "../../domain/void-expected-paid.ts";
import {
  archiveLines,
  invoiceOwner,
  lockInvoice,
  revokeLinks,
  saveEditedTotals,
  voidInvoiceRow,
  type LockedInvoice,
} from "../../persistence/pg-invoice-changes.ts";
import { insertLines, readInvoice } from "../../persistence/pg-invoice-store.ts";
import { readPatientMoney } from "../../persistence/pg-patient-money.ts";
import { insertCredit } from "../../persistence/pg-payment-writes.ts";
import type { BillingLineDoctorLocks } from "../../ports/billing-members.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import {
  checkServiceLines,
  lineDoctorIds,
  storedLines,
  unknownLineDoctor,
} from "../invoice-lines.ts";

export interface ChangeDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly patients: BillingPatientReader;
  readonly members: BillingLineDoctorLocks;
}

type DiscountLike = Invoice["invoiceDiscount"] | UpdateInvoiceRequest["invoiceDiscount"];

interface DiscountedLine {
  readonly kind: string;
  readonly serviceId?: string | null;
  readonly providerId?: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: string;
  readonly discount: DiscountLike;
}

/** رصيد اتكتب من release واحدة: معرّفه والحركة اللي خرجت منها. */
interface ReleasedCredit {
  readonly creditId: string;
  readonly release: Release;
}

// R1-14: what the discount key guards — every discount's kind, value and reason, with the line it sits
// on and that line's position, so it can neither change nor move, not even between two identical lines.
// An undiscounted line is not part of it: adding or removing one after the discounted lines needs no
// discount key (PR #78 review). Built field by field, since jsonb gives the stored discount back
// with its keys in another order.
const canonical = (d: DiscountLike) =>
  d === null ? null : [d.kind, d.kind === "pct" ? d.bp : d.minor, d.reason];
const discountsOf = (invoice: {
  readonly lines: readonly DiscountedLine[];
  readonly invoiceDiscount: DiscountLike;
}) =>
  JSON.stringify([
    invoice.lines
      .map((l, position) => ({ l, position }))
      .filter(({ l }) => l.discount !== null)
      .map(({ l, position }) => [
        position,
        l.kind,
        l.serviceId ?? null,
        l.providerId ?? null,
        l.quantity,
        l.unitPriceMinor,
        canonical(l.discount),
      ]),
    canonical(invoice.invoiceDiscount),
  ]);

/**
 * تعديل الفاتورة وإلغاؤها (FIN-A5، FIN-8، spec §8 rules 8 و10). القفل بالترتيب: عضوية أطباء السطور،
 * بعدين المراجع، بعدين الفاتورة `FOR UPDATE`، وبعد القفل بس بتتراجع الحالة والنسخة (`If-Match`). كل تغيير
 * بيزوّد النسخة وبيكتب صف سجل قبل/بعد. الرقم والفرع والمصدر والتاريخ عمرهم ما بيتغيروا.
 *
 * تعديل فاتورة مدفوعة بيقلّل الإجمالي، أو إلغاؤها، بيرجّع الزيادة رصيداً للمراجع (F2-Q18: آخر دفعة
 * الأول) في نفس الـ transaction؛ ورفع الإجمالي ما بياخدش رصيد مراجع تاني.
 */
export class InvoiceChanges {
  constructor(private readonly deps: ChangeDeps) {}

  /**
   * يعدّل السطور والخصومات ويعيد الحساب بنسبة الضريبة المحفوظة في الفاتورة.
   *
   * @param actor الفاعل (شايل `update:invoices` بنطاق `clinic` أو `branch`)
   * @param id الفاتورة
   * @param ifMatch النسخة اللي الفورم شافها
   * @param body السطور والخصم الجداد
   * @returns الفاتورة بعد التعديل
   */
  edit(
    actor: BillingActor,
    id: string,
    ifMatch: number,
    body: UpdateInvoiceRequest,
  ): Promise<Invoice> {
    // A line doctor of no clinic fails the lines' foreign key: 400, as in issue (PR #78 review).
    return this.change(
      actor,
      "update",
      id,
      ifMatch,
      lineDoctorIds(body.lines),
      async (tx, before, locked, now, money) => {
        if (discountsOf(before) !== discountsOf(body) && !mayDiscount(actor, locked.branchId)) {
          throw new ApiError("forbidden");
        }
        const names = await checkServiceLines(tx, actor.clinicId, body.lines, before.lines);
        const totals = invoiceTotals(body.lines, body.invoiceDiscount, locked.taxRateBp);
        const invoice = {
          id: before.id,
          status: locked.status,
          totalMinor: BigInt(before.totalMinor),
        };
        const releases = settle(() => planEditRelease(money, invoice, totals.totalMinor));
        await archiveLines(tx, actor.clinicId, id, now);
        await insertLines(
          tx,
          actor.clinicId,
          id,
          storedLines(this.deps.ids, body.lines, names, totals),
          now,
        );
        await saveEditedTotals(
          tx,
          actor.clinicId,
          id,
          {
            subtotalMinor: totals.subtotalMinor.toString(),
            discountMinor: totals.discountMinor.toString(),
            taxMinor: totals.taxMinor.toString(),
            totalMinor: totals.totalMinor.toString(),
            invoiceDiscount: body.invoiceDiscount,
          },
          now,
        );
        return { action: "invoice.edited", releases };
      },
    ).catch(unknownLineDoctor);
  }

  /**
   * يلغي الفاتورة: الرقم بيفضل، وروابط المراجع الشغالة بتتقفل، والمصدر يقدر يتفوتر تاني.
   *
   * @param actor الفاعل (شايل `deactivate:invoices` بنطاق `clinic` أو `branch`)
   * @param id الفاتورة
   * @param ifMatch النسخة اللي الفورم شافها
   * @param body السبب (بيتخزن في الفاتورة، والسجل بياخد طوله بس) والمبلغ المدفوع اللي الموظف أكده (#113)
   * @returns الفاتورة بعد الإلغاء
   */
  void(actor: BillingActor, id: string, ifMatch: number, body: VoidBody): Promise<Invoice> {
    return this.change(
      actor,
      "deactivate",
      id,
      ifMatch,
      [],
      async (tx, before, locked, now, money) => {
        // The confirmed amount is judged under the invoice lock, before any write (issue #113).
        requireExpectedPaid(before.settlement?.paidMinor ?? "0", body.expectedPaidMinor);
        const invoice = {
          id: before.id,
          status: locked.status,
          totalMinor: BigInt(before.totalMinor),
        };
        const releases = settle(() => planVoidRelease(money, invoice));
        await voidInvoiceRow(tx, actor.clinicId, id, body.reason, now);
        await revokeLinks(tx, actor.clinicId, id, now);
        return { action: "invoice.voided", reasonLength: body.reason.length, releases };
      },
    );
  }

  private change(
    actor: BillingActor,
    action: "update" | "deactivate",
    id: string,
    ifMatch: number,
    lineDoctors: readonly string[],
    apply: (
      tx: Tx,
      before: Invoice,
      locked: LockedInvoice,
      now: Date,
      money: PatientMoney,
    ) => Promise<{ action: string; reasonLength?: number; releases: readonly Release[] }>,
  ): Promise<Invoice> {
    const reach = branchReach(actor, action);
    if (reach === null) throw new ApiError("forbidden");
    const { db, clock, ids, patients } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const owner = await invoiceOwner(tx, actor.clinicId, id);
      if (owner === null || !reachesBranch(reach, owner.branchId)) throw new ApiError("not_found");
      // ADR-0027 item 6 (spec §8d R3-4): the lines' membership rows come before the patient row.
      await this.deps.members.lockLineDoctors(tx, actor.clinicId, lineDoctors);
      await patients.lockForInvoice(tx, actor.clinicId, owner.patientId);
      const locked = (await lockInvoice(tx, actor.clinicId, id))!;
      if (locked.status === "void") throw new ApiError("invoice_void");
      if (locked.version !== ifMatch) throw new ApiError("version_conflict");
      const before = (await readInvoice(tx, actor.clinicId, id))!;
      const now = clock.now();
      const money = await readPatientMoney(tx, actor.clinicId, locked.patientId);
      const done = await apply(tx, before, locked, now, money);
      // The credits are written before the invoice is read again, so the answer sees them.
      const credits = await this.releaseIntoCredits(tx, actor, locked, done.releases, now);
      const after = (await readInvoice(tx, actor.clinicId, id))!;
      await writeFinanceAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: done.action,
        entityType: "invoice",
        entityId: id,
        branchId: locked.branchId,
        before: invoiceAuditSnapshot(before),
        after: invoiceAuditSnapshot(after),
        ...(done.reasonLength === undefined ? {} : { reasonLength: done.reasonLength }),
        createdAt: now,
      });
      for (const credit of credits) {
        await writeFinanceAudit(tx, {
          clinicId: actor.clinicId,
          id: ids.newId(),
          actorUserId: actor.userId,
          action: "credit.released",
          entityType: "patient_credit",
          entityId: credit.creditId,
          branchId: locked.branchId,
          before: null,
          after: {
            invoiceNumber: before.number,
            amountMinor: String(credit.release.amountMinor),
            currency: before.currency,
            cause: credit.release.cause,
            allocationId: credit.release.allocationId,
          },
          createdAt: now,
        });
      }
      return after;
    });
  }

  /**
   * بيكتب رصيد لكل release: فلوس رجعت للمراجع من تخصيص على الفاتورة (R1-5، R2-2، F2-Q18).
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param actor الفاعل
   * @param locked الفاتورة تحت القفل
   * @param releases الحركات اللي رجعت، بالترتيب اللي الخطة رتّبتها
   * @param now لحظة الكتابة
   * @returns الأرصدة اللي اتكتبت، بالمعرّف بتاع كل واحد
   */
  private async releaseIntoCredits(
    tx: Tx,
    actor: BillingActor,
    locked: LockedInvoice,
    releases: readonly Release[],
    now: Date,
  ): Promise<readonly ReleasedCredit[]> {
    const credits: ReleasedCredit[] = [];
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
      credits.push({ creditId, release });
    }
    return credits;
  }
}
