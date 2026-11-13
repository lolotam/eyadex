import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { paymentsReach } from "../../domain/money-reach.ts";
import { pdfSubscriptionBlocked } from "../../domain/pdf-delivery.ts";
import { readPayment } from "../../persistence/pg-payment-reads.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import type { InvoicePdfAccessReader } from "../../ports/invoice-pdf-access.ts";
import type { ReceiptPdfRenderer } from "../../ports/receipt-pdf.ts";

/** تسليم إيصال الدفعة الأصلية لصاحب صلاحية المدفوعات، بلا رابط عام. */
export class ReceiptPdfs {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly patients: BillingPatientReader;
      readonly pdf: ReceiptPdfRenderer;
      readonly access: InvoicePdfAccessReader;
    },
  ) {}

  /**
   * يرسم خارج المعاملة ثم يعيد فحص التفويض الحالي قبل تسليم الملف وتسجيل الوصول.
   * @param actor الفاعل صاحب صلاحية عرض المدفوعات
   * @param id معرّف الدفعة
   * @returns رقم الإيصال والملف المكتمل
   */
  async open(actor: BillingActor, id: string): Promise<{ number: string; pdf: Uint8Array }> {
    const reach = paymentsReach(actor, "view");
    if (!reach) throw new ApiError("forbidden");
    const payment = await this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const found = await readPayment(tx, actor.clinicId, id);
      if (!found || !reachesBranch(reach, found.branchId)) throw new ApiError("not_found");
      const patientName = await this.deps.patients.displayName(tx, actor.clinicId, found.patientId);
      if (patientName === null) throw new ApiError("not_found");
      return { ...found, patientName };
    });
    const pdf = await this.deps.pdf.render(actor.clinicId, payment);
    await this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const access = await this.deps.access.read(tx, actor.clinicId, actor.userId);
      if (!access || !access.active || access.membershipId !== actor.membershipId)
        throw new ApiError("account_disabled");
      if (pdfSubscriptionBlocked(access.clinicStatus, access.expiresAt, this.deps.clock.now()))
        throw new ApiError("subscription_blocked");
      if (!access.financeEnabled) throw new ApiError("module_disabled");
      if (!access.roleActive) throw new ApiError("forbidden");
      const finalReach = paymentsReach(
        {
          ...actor,
          permissions: access.permissions,
          member: access.allBranches ? { all: true } : { all: false, branchIds: access.branchIds },
        },
        "view",
      );
      if (!finalReach) throw new ApiError("forbidden");
      const current = await readPayment(tx, actor.clinicId, id);
      if (!current || !reachesBranch(finalReach, current.branchId)) throw new ApiError("not_found");
      await writeFinanceAudit(tx, {
        clinicId: actor.clinicId,
        id: this.deps.ids.newId(),
        actorUserId: actor.userId,
        action: "payment.pdf_opened",
        entityType: "payment",
        entityId: payment.id,
        branchId: payment.branchId,
        before: null,
        after: null,
        createdAt: this.deps.clock.now(),
      });
    });
    return { number: payment.receiptNumber, pdf };
  }
}
