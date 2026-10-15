import type {
  Invoice,
  InvoiceListQuery,
  invoiceListResponseSchema,
} from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { reachesBranch, viewReach, type ViewReach } from "../../domain/invoice-reach.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { listInvoices } from "../../queries/invoice-list.ts";

/**
 * قراية الفواتير (spec §3.3، §8 rule 12): القايمة والفاتورة الواحدة جوه نطاق عرض الفاعل. فاتورة برا
 * النطاق = `not_found` زي فاتورة عيادة تانية (ISO-02).
 */
export class InvoiceReads {
  constructor(
    private readonly deps: { readonly db: Database; readonly patients: BillingPatientReader },
  ) {}

  /**
   * صفحة من الفواتير، الأحدث الأول، بالفلاتر.
   *
   * @param actor الفاعل (شايل `view:invoices` بأي نطاق)
   * @param query الفلاتر والصفحة
   * @returns الصفحة والمؤشر التالي والعدد الكلي
   */
  list(
    actor: BillingActor,
    query: InvoiceListQuery,
  ): Promise<z.infer<typeof invoiceListResponseSchema>> {
    const reach = this.reachOf(actor);
    return this.deps.db.withTenant(actor.clinicId, (tx) =>
      listInvoices(tx, actor.clinicId, query, this.condition(reach)),
    );
  }

  /**
   * الفاتورة بسطورها النشطة.
   *
   * @param actor الفاعل (شايل `view:invoices` بأي نطاق)
   * @param id الفاتورة
   * @returns الفاتورة
   */
  get(actor: BillingActor, id: string): Promise<Invoice> {
    const reach = this.reachOf(actor);
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const invoice = await readInvoice(tx, actor.clinicId, id);
      if (invoice === null) throw new ApiError("not_found");
      const visible =
        "own" in reach
          ? (await this.deps.patients.access(tx, actor.clinicId, actor, invoice.patientId)).own
          : reachesBranch(reach, invoice.branchId);
      if (!visible) throw new ApiError("not_found");
      return invoice;
    });
  }

  private reachOf(actor: BillingActor): ViewReach {
    const reach = viewReach(actor);
    if (reach === null) throw new ApiError("forbidden");
    return reach;
  }

  private condition(reach: ViewReach): SQL {
    if ("own" in reach) return this.deps.patients.ownPatientFilter(reach.own, sql`i.patient_id`);
    if (reach.all) return sql`true`;
    if (reach.branchIds.length === 0) return sql`false`;
    return sql`i.branch_id IN (${sql.join(
      reach.branchIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`;
  }
}
