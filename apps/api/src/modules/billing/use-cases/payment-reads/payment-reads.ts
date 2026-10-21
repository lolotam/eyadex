import type {
  Payment,
  PaymentListQuery,
  invoicePaymentsResponseSchema,
  paymentListResponseSchema,
} from "@eyadex/contracts/finance";
import type { BranchOptionListResponse, OptionListQuery } from "@eyadex/contracts/role-admin";
import { creditBalance, paymentRefundable } from "@eyadex/contracts/settlement";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { paymentsReach } from "../../domain/money-reach.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import { readInvoiceMoney, readPatientMoney } from "../../persistence/pg-patient-money.ts";
import { invoiceMovementRows, readPayment } from "../../persistence/pg-payment-reads.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { listPaymentBranchOptions } from "../../queries/payment-branch-options.ts";
import { listPayments } from "../../queries/payment-list.ts";

/**
 * قراية المدفوعات (spec §4.6): حركات فاتورة (إيصالات وأرصدة متصرفة ومرتجعة) مع رصيد المراجع، وقايمة
 * الإيصالات، والإيصال لوحده. الفاتورة أو الإيصال برا نطاق الفاعل = `not_found` زي فاتورة عيادة
 * تانية (ISO-02).
 */
export class PaymentReads {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly patients: BillingPatientReader;
    },
  ) {}

  /**
   * حركات الفاتورة كلها: إيصالاتها، والأرصدة اللي اتصرفت عليها، والأرصدة اللي رجعت، والمرتجعات،
   * الأقدم الأول، مع حالة الفاتورة ورصيد المراجع.
   *
   * @param actor الفاعل (شايل `view:payments` بنطاق `clinic` أو `branch`)
   * @param invoiceId الفاتورة
   * @returns الحركات وحالة الفاتورة ورصيد المراجع
   */
  invoicePayments(
    actor: BillingActor,
    invoiceId: string,
  ): Promise<z.infer<typeof invoicePaymentsResponseSchema>> {
    const reach = paymentsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const invoice = await readInvoice(tx, actor.clinicId, invoiceId);
      if (invoice === null || !reachesBranch(reach, invoice.branchId))
        throw new ApiError("not_found");
      const rows = await invoiceMovementRows(tx, actor.clinicId, invoiceId);
      // The money of the invoice, so every receipt carries what may still be refunded from it.
      const money = await readInvoiceMoney(tx, actor.clinicId, [invoiceId]);
      const movements = rows.map((row) =>
        row.kind === "payment"
          ? { ...row, refundableMinor: String(paymentRefundable(money, row.paymentId)) }
          : row,
      );
      const patientMoney = await readPatientMoney(tx, actor.clinicId, invoice.patientId);
      return {
        invoiceId,
        currency: invoice.currency,
        currencyExponent: invoice.currencyExponent,
        settlement: invoice.settlement ?? null,
        creditBalanceMinor: String(creditBalance(patientMoney)),
        movements,
      };
    });
  }

  /**
   * صفحة من الإيصالات، الأحدث الأول، بالفلاتر.
   *
   * @param actor الفاعل (شايل `view:payments` بنطاق `clinic` أو `branch`)
   * @param query الفلاتر والصفحة
   * @returns الصفحة والمؤشر التالي والعدد الكلي
   */
  list(
    actor: BillingActor,
    query: PaymentListQuery,
  ): Promise<z.infer<typeof paymentListResponseSchema>> {
    const reach = paymentsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, (tx) =>
      listPayments(tx, actor.clinicId, query, reach, this.deps.patients),
    );
  }

  /**
   * فروع العيادة اللي الفاعل يقدر يقرأ فيها مدفوعات، كاختيارات لفلتر شاشة الإيصالات (spec §4.6).
   * المدى هو مدى `view:payments` نفسه: `clinic` = كل فروع العيادة، `branch` = فروع العضو بس.
   *
   * @param actor الفاعل (شايل `view:payments` بنطاق `clinic` أو `branch`)
   * @param query الـ cursor والحد
   * @returns الصفحة والمؤشر التالي والعدد الكلي
   */
  branchOptions(actor: BillingActor, query: OptionListQuery): Promise<BranchOptionListResponse> {
    const reach = paymentsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, (tx) =>
      listPaymentBranchOptions(tx, actor.clinicId, reach, query),
    );
  }

  /**
   * الإيصال لوحده، باسم المراجع.
   *
   * @param actor الفاعل (شايل `view:payments` بنطاق `clinic` أو `branch`)
   * @param id الإيصال
   * @returns الإيصال
   */
  get(actor: BillingActor, id: string): Promise<{ payment: Payment }> {
    const reach = paymentsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const payment = await readPayment(tx, actor.clinicId, id);
      if (payment === null || !reachesBranch(reach, payment.branchId))
        throw new ApiError("not_found");
      const patientName = await this.deps.patients.displayName(
        tx,
        actor.clinicId,
        payment.patientId,
      );
      if (patientName === null) throw new ApiError("not_found");
      return { payment: { ...payment, patientName } };
    });
  }
}
