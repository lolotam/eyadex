import type { Refund, RefundListQuery, refundListResponseSchema } from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { paymentsReach } from "../../domain/money-reach.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { listRefunds } from "../../queries/refund-list.ts";
import { refundInReach } from "./refund-view.ts";

/**
 * قراية المرتجعات (spec §4.6): القايمة والسند لوحده، بمفتاح `view:payments` (مفيش `view:refunds`،
 * spec §4.1). الاسترداد برا نطاق الفاعل = `not_found` زي استرداد عيادة تانية (ISO-02).
 */
export class RefundReads {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly patients: BillingPatientReader;
    },
  ) {}

  /**
   * صفحة من المرتجعات، الأحدث الأول، بالفلاتر.
   *
   * @param actor الفاعل (شايل `view:payments` بنطاق `clinic` أو `branch`)
   * @param query الفلاتر والصفحة
   * @returns الصفحة والمؤشر التالي والعدد الكلي
   */
  list(
    actor: BillingActor,
    query: RefundListQuery,
  ): Promise<z.infer<typeof refundListResponseSchema>> {
    const reach = paymentsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, (tx) =>
      listRefunds(tx, actor.clinicId, query, reach, this.deps.patients),
    );
  }

  /**
   * سند صرف واحد باسم المراجع، حتى لو فاتورته اتلغت.
   *
   * @param actor الفاعل (شايل `view:payments` بنطاق `clinic` أو `branch`)
   * @param id الاسترداد
   * @returns الاسترداد
   */
  get(actor: BillingActor, id: string): Promise<{ refund: Refund }> {
    const reach = paymentsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => ({
      refund: await refundInReach(tx, this.deps.patients, actor.clinicId, reach, id),
    }));
  }
}
