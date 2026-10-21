import type {
  CashClosingDetail,
  CashClosingListQuery,
  cashClosingListResponseSchema,
} from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor, MemberBranches } from "../../domain/billing-actor.ts";
import { cashClosingsReach } from "../../domain/money-reach.ts";
import { listCashClosings } from "../../queries/cash-closing-list.ts";
import { closingInReach } from "./closing-view.ts";

/**
 * قراية إقفالات الصندوق (spec §4.6): القايمة والإقفال لوحده بحركاته، من غير أسماء مراجعين. الإقفال برا
 * نطاق الفاعل = `not_found` زي إقفال عيادة تانية (ISO-02).
 */
export class CashClosingReads {
  constructor(private readonly deps: { readonly db: Database }) {}

  /**
   * صفحة من الإقفالات، الأحدث الأول، بالفرع والأيام.
   *
   * @param actor الفاعل (شايل `view:cash_closings` بنطاق `clinic` أو `branch`)
   * @param query الفلاتر والصفحة
   * @returns الصفحة والمؤشر التالي والعدد الكلي
   */
  list(
    actor: BillingActor,
    query: CashClosingListQuery,
  ): Promise<z.infer<typeof cashClosingListResponseSchema>> {
    const reach = this.reach(actor);
    return this.deps.db.withTenant(actor.clinicId, (tx) =>
      listCashClosings(tx, actor.clinicId, query, reach),
    );
  }

  /**
   * إقفال واحد بحركات فترته النقدية.
   *
   * @param actor الفاعل (شايل `view:cash_closings` بنطاق `clinic` أو `branch`)
   * @param id الإقفال
   * @returns الإقفال بحركاته
   */
  get(actor: BillingActor, id: string): Promise<{ cashClosing: CashClosingDetail }> {
    const reach = this.reach(actor);
    return this.deps.db.withTenant(actor.clinicId, async (tx) => ({
      cashClosing: await closingInReach(tx, actor.clinicId, reach, id),
    }));
  }

  /**
   * نطاق القراية: فرع الإقفال جوه مفتاح `view:cash_closings`.
   *
   * @returns الفروع
   * @throws ApiError `forbidden` لما مالوش المفتاح بأي نطاق
   */
  private reach(actor: BillingActor): MemberBranches {
    const reach = cashClosingsReach(actor, "view");
    if (reach === null) throw new ApiError("forbidden");
    return reach;
  }
}
