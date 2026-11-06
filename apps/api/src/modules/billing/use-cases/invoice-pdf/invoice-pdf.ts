import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { viewReach } from "../../domain/invoice-reach.ts";
import { pdfSubscriptionBlocked } from "../../domain/pdf-delivery.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import { shareInvoice } from "../../persistence/pg-invoice-changes.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import type { InvoicePdfRenderer } from "../../ports/invoice-pdf.ts";
import type { InvoicePdfAccessReader } from "../../ports/invoice-pdf-access.ts";
import { invoiceVisible } from "../invoice-visible.ts";

/**
 * الفاتورة PDF (spec §3.3، FIN-5): آخر نسخة، جوه نطاق عرض الفاعل، وصف سجل وصول للمراجع. نفس الراسم بتاع رابط
 * المراجع؛ لحد plan Task 8g بيرد 503.
 */
export class InvoicePdfs {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly patients: BillingPatientReader;
      readonly pdf: InvoicePdfRenderer;
      readonly access: InvoicePdfAccessReader;
    },
  ) {}

  /**
   * بيرسم الفاتورة.
   *
   * @param actor الفاعل (شايل `view:invoices` بأي نطاق)
   * @param id الفاتورة
   * @returns رقم الفاتورة (اسم الملف) والملف
   */
  async open(actor: BillingActor, id: string): Promise<{ number: string; pdf: Uint8Array }> {
    const reach = viewReach(actor);
    if (reach === null) throw new ApiError("forbidden");
    const invoice = await this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const found = await readInvoice(tx, actor.clinicId, id);
      if (found === null || !(await invoiceVisible(tx, this.deps.patients, actor, reach, found))) {
        throw new ApiError("not_found");
      }
      return found;
    });
    const pdf = await this.deps.pdf.render(actor.clinicId, invoice);
    // Audited only once the file exists: a render that fails opened nothing (PR #78 review).
    await this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const current = await shareInvoice(tx, actor.clinicId, id);
      const access = await this.deps.access.read(tx, actor.clinicId, actor.userId);
      if (!access || !access.active || access.membershipId !== actor.membershipId)
        throw new ApiError("account_disabled");
      if (pdfSubscriptionBlocked(access.clinicStatus, access.expiresAt, this.deps.clock.now()))
        throw new ApiError("subscription_blocked");
      if (!access.financeEnabled) throw new ApiError("module_disabled");
      if (!access.roleActive) throw new ApiError("forbidden");
      const finalActor: BillingActor = {
        ...actor,
        permissions: access.permissions,
        member: access.allBranches ? { all: true } : { all: false, branchIds: access.branchIds },
      };
      const finalReach = viewReach(finalActor);
      if (finalReach === null) throw new ApiError("forbidden");
      if (
        current === null ||
        !(await invoiceVisible(tx, this.deps.patients, finalActor, finalReach, current))
      ) {
        throw new ApiError("not_found");
      }
      if (current.version !== invoice.version || current.status !== invoice.status) {
        throw new ApiError("version_conflict");
      }
      await writeFinanceAudit(tx, {
        clinicId: actor.clinicId,
        id: this.deps.ids.newId(),
        actorUserId: actor.userId,
        action: "invoice.pdf_opened",
        entityType: "invoice",
        entityId: invoice.id,
        branchId: invoice.branchId,
        before: null,
        after: null,
        createdAt: this.deps.clock.now(),
      });
    });
    return { number: invoice.number, pdf };
  }
}
