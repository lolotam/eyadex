import type { PriceList, ServicePrice } from "@eyadex/contracts/finance";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import {
  clinicCurrency,
  lockClinicFinance,
  readPrices,
  replaceProviderPrices,
  serviceExists,
  serviceLabels,
  setBasePrice,
} from "../../persistence/pg-price-store.ts";

// The service is checked first, so the only foreign key left to fail is a member of another clinic or
// none (memberships belong to identity; billing never reads them).
function unknownMember(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23503") {
    throw new ApiError("validation", [{ path: ["items"], code: "unknownMember" }]);
  }
  throw error;
}

export interface PriceDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * أسعار الخدمات (FIN-A8، R1-13، R2-3): سعر أساسي لكل خدمة، وسعر لكل دكتور بيغلبه. كل كتابة بتاخد قفل
 * مالية العيادة الأول، نفس قفل تغيير العملة وأول إصدار، فمفيش سعر بيدخل وسط تغيير العملة. صف سجل
 * إداري بأسماء الحقول وعدد الدكاترة بس، من غير المبالغ.
 */
export class PriceChanges {
  constructor(private readonly deps: PriceDeps) {}

  /**
   * أسعار كل خدمات العيادة مع عملتها.
   *
   * @param clinicId العيادة
   * @returns العملة والأسعار
   */
  list(clinicId: string): Promise<PriceList> {
    return this.deps.db.withTenant(clinicId, async (tx) => {
      const currency = await clinicCurrency(tx, clinicId);
      const prices = await readPrices(tx, clinicId);
      const labels = await serviceLabels(tx, clinicId);
      return { ...currency, items: prices.map((p) => ({ ...p, ...labels.get(p.serviceId) })) };
    });
  }

  /**
   * السعر الأساسي للخدمة، أو `null` = لسه مالهاش سعر.
   *
   * @param actor الفاعل (شايل `update:prices:clinic`)
   * @param serviceId الخدمة
   * @param priceMinor السعر بالوحدة الصغيرة
   * @returns أسعار الخدمة بعد الحفظ
   */
  setServicePrice(
    actor: BillingActor,
    serviceId: string,
    priceMinor: string | null,
  ): Promise<ServicePrice> {
    return this.write(actor, serviceId, async (tx) => {
      await setBasePrice(tx, actor.clinicId, serviceId, priceMinor, this.deps.clock.now());
      return { action: "service.price_set", details: { changed: ["priceMinor"] } };
    });
  }

  /**
   * بيستبدل قايمة أسعار الدكاترة للخدمة كلها؛ قايمة فاضية = مفيش سعر دكتور.
   *
   * @param actor الفاعل (شايل `update:prices:clinic`)
   * @param serviceId الخدمة
   * @param items عضو وسعره، من غير تكرار
   * @returns أسعار الخدمة بعد الحفظ
   */
  replaceProviderPrices(
    actor: BillingActor,
    serviceId: string,
    items: readonly { memberId: string; priceMinor: string }[],
  ): Promise<ServicePrice> {
    return this.write(actor, serviceId, async (tx) => {
      const rows = items.map((i) => ({ id: this.deps.ids.newId(), ...i }));
      await replaceProviderPrices(tx, actor.clinicId, serviceId, rows, this.deps.clock.now());
      return { action: "service.provider_prices_set", details: { providerCount: items.length } };
    }).catch(unknownMember);
  }

  private write(
    actor: BillingActor,
    serviceId: string,
    apply: (tx: Tx) => Promise<{ action: string; details: Record<string, unknown> }>,
  ): Promise<ServicePrice> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockClinicFinance(tx, actor.clinicId);
      if (!(await serviceExists(tx, actor.clinicId, serviceId))) throw new ApiError("not_found");
      const { action, details } = await apply(tx);
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action,
        entityType: "clinic_service",
        entityId: serviceId,
        details,
        createdAt: clock.now(),
      });
      const [saved] = await readPrices(tx, actor.clinicId, serviceId);
      // The service row was checked under the finance lock above, so it is still there.
      if (saved === undefined) throw new ApiError("not_found");
      return saved;
    });
  }
}
