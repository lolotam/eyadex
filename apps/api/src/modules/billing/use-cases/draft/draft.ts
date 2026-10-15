import type { InvoiceDraft } from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { branchReach } from "../../domain/invoice-reach.ts";
import { effectivePrice } from "../../persistence/pg-price-store.ts";
import { loadSource, type SourceReaders } from "../invoice-source.ts";

/**
 * مسودة فاتورة من موعد أو زيارة (FIN-A8، R1-7): سطر خدمة واحد بسعر الدكتور أو السعر الأساسي، ومن غير
 * خدمة مفيش سطر. خدمة من غير سعر بتطلع بسطر سعره صفر و`priceMissing`، والإصدار بيرفضها. مفيش حاجة
 * بتتخزن.
 */
export class InvoiceDrafts {
  constructor(private readonly deps: { readonly db: Database; readonly sources: SourceReaders }) {}

  /**
   * المسودة.
   *
   * @param actor الفاعل (شايل `create:invoices` بنطاق `clinic` أو `branch`)
   * @param source نوع المصدر
   * @param sourceId المصدر
   * @returns المسودة
   */
  draft(
    actor: BillingActor,
    source: "appointment" | "visit",
    sourceId: string,
  ): Promise<InvoiceDraft> {
    const reach = branchReach(actor, "create");
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const facts = await loadSource(
        tx,
        this.deps.sources,
        actor.clinicId,
        reach,
        source,
        sourceId,
      );
      const base = { source, sourceId, patientId: facts.patientId, branchId: facts.branchId };
      if (facts.serviceId === null) return { ...base, priceMissing: false, lines: [] };
      const price = await effectivePrice(tx, actor.clinicId, facts.serviceId, facts.providerId);
      const line = {
        kind: "service" as const,
        serviceId: facts.serviceId,
        providerId: facts.providerId,
        quantity: 1,
        unitPriceMinor: price ?? "0",
        discount: null,
      };
      return { ...base, priceMissing: price === null, lines: [line] };
    });
  }
}
