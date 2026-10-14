import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import type { DeliveryUpdate } from "../../domain/delivery-status.ts";
import type { EvolutionWebhookEvent } from "../../domain/evolution-webhook.ts";
import { applyProviderStatus } from "../../persistence/pg-delivery-status.ts";
import { closeEvolutionChannel } from "../../persistence/pg-evolution-webhook.ts";

/** أحداث Evolution تعمل كفاعل نظام وتبقى تحت عزل العيادة، دون قراءة بيانات المراجع. */
export class EvolutionWebhook {
  constructor(private readonly deps: { db: Database; clock: { now(): Date }; ids: IdGenerator }) {}

  async apply(event: EvolutionWebhookEvent): Promise<void> {
    const { db, clock, ids } = this.deps;
    await db.withTenant(event.clinicId, async (tx) => {
      const at = clock.now();
      if (event.kind !== "closed") {
        // Evolution's payload carries no reliable event time: the receipt is dated when it arrives.
        const update: DeliveryUpdate =
          event.kind === "rejected"
            ? { kind: "failed", code: "evo_delivery_rejected" }
            : { kind: event.kind, at };
        await applyProviderStatus(
          tx,
          { clinicId: event.clinicId, transport: "evolution", messageId: event.messageId },
          update,
          at,
        );
        return;
      }
      const rows = await closeEvolutionChannel(tx, event.clinicId, at);
      if (rows.length === 0) return;
      await writeClinicAudit(tx, {
        clinicId: event.clinicId,
        id: ids.newId(),
        actorUserId: SYSTEM_ACTOR_ID,
        action: "clinic.whatsapp_disconnected",
        entityType: "clinic",
        entityId: event.clinicId,
        details: { transport: "evolution", reason: "connection_closed" },
        createdAt: at,
      });
    });
  }
}
