import type { Invoice, UpdateInvoiceRequest } from "@eyadex/contracts/finance";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { invoiceAuditSnapshot, writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { branchReach, reachesBranch } from "../../domain/invoice-reach.ts";
import { invoiceTotals, mayDiscount } from "../../domain/invoice-rules.ts";
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
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { checkServiceLines, storedLines } from "../invoice-lines.ts";

export interface ChangeDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly patients: BillingPatientReader;
}

type DiscountLike = Invoice["invoiceDiscount"] | UpdateInvoiceRequest["invoiceDiscount"];

// R1-14: what the discount key guards — every discount's place, kind, value and reason. Built field by
// field, since jsonb gives the stored discount back with its keys in another order.
const canonical = (d: DiscountLike) =>
  d === null ? null : [d.kind, d.kind === "pct" ? d.bp : d.minor, d.reason];
const discountsOf = (invoice: {
  readonly lines: readonly { readonly discount: DiscountLike }[];
  readonly invoiceDiscount: DiscountLike;
}) =>
  JSON.stringify([
    invoice.lines.map((line) => canonical(line.discount)),
    canonical(invoice.invoiceDiscount),
  ]);

/**
 * تعديل الفاتورة وإلغاؤها (FIN-A5، FIN-8، spec §8 rules 8 و10). القفل بالترتيب: المراجع، بعدين الفاتورة
 * `FOR UPDATE`، وبعد القفل بس بتتراجع الحالة والنسخة (`If-Match`). كل تغيير بيزوّد النسخة وبيكتب صف سجل
 * قبل/بعد. الرقم والفرع والمصدر والتاريخ عمرهم ما بيتغيروا.
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
    return this.change(actor, "update", id, ifMatch, async (tx, before, locked, now) => {
      if (discountsOf(before) !== discountsOf(body) && !mayDiscount(actor, locked.branchId)) {
        throw new ApiError("forbidden");
      }
      const names = await checkServiceLines(tx, actor.clinicId, body.lines);
      const totals = invoiceTotals(body.lines, body.invoiceDiscount, locked.taxRateBp);
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
      return { action: "invoice.edited" };
    });
  }

  /**
   * يلغي الفاتورة: الرقم بيفضل، وروابط المراجع الشغالة بتتقفل، والمصدر يقدر يتفوتر تاني.
   *
   * @param actor الفاعل (شايل `deactivate:invoices` بنطاق `clinic` أو `branch`)
   * @param id الفاتورة
   * @param ifMatch النسخة اللي الفورم شافها
   * @param reason سبب الإلغاء (بيتخزن في الفاتورة، والسجل بياخد طوله بس)
   * @returns الفاتورة بعد الإلغاء
   */
  void(actor: BillingActor, id: string, ifMatch: number, reason: string): Promise<Invoice> {
    return this.change(actor, "deactivate", id, ifMatch, async (tx, _before, _locked, now) => {
      await voidInvoiceRow(tx, actor.clinicId, id, reason, now);
      await revokeLinks(tx, actor.clinicId, id, now);
      return { action: "invoice.voided", reasonLength: reason.length };
    });
  }

  private change(
    actor: BillingActor,
    action: "update" | "deactivate",
    id: string,
    ifMatch: number,
    apply: (
      tx: Tx,
      before: Invoice,
      locked: LockedInvoice,
      now: Date,
    ) => Promise<{ action: string; reasonLength?: number }>,
  ): Promise<Invoice> {
    const reach = branchReach(actor, action);
    if (reach === null) throw new ApiError("forbidden");
    const { db, clock, ids, patients } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const owner = await invoiceOwner(tx, actor.clinicId, id);
      if (owner === null || !reachesBranch(reach, owner.branchId)) throw new ApiError("not_found");
      await patients.lockForInvoice(tx, actor.clinicId, owner.patientId);
      const locked = (await lockInvoice(tx, actor.clinicId, id))!;
      if (locked.status === "void") throw new ApiError("invoice_void");
      if (locked.version !== ifMatch) throw new ApiError("version_conflict");
      const before = (await readInvoice(tx, actor.clinicId, id))!;
      const now = clock.now();
      const done = await apply(tx, before, locked, now);
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
      return after;
    });
  }
}
