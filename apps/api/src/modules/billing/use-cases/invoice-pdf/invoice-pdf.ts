import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { viewReach } from "../../domain/invoice-reach.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import type { InvoicePdfRenderer } from "../../ports/invoice-pdf.ts";
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
      await writeFinanceAudit(tx, {
        clinicId: actor.clinicId,
        id: this.deps.ids.newId(),
        actorUserId: actor.userId,
        action: "invoice.pdf_opened",
        entityType: "invoice",
        entityId: found.id,
        branchId: found.branchId,
        before: null,
        after: null,
        createdAt: this.deps.clock.now(),
      });
      return found;
    });
    return { number: invoice.number, pdf: await this.deps.pdf.render(actor.clinicId, invoice) };
  }
}
