import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import type { EvolutionWebhookEvent } from "../../domain/evolution-webhook.ts";
import {
  closeEvolutionChannel,
  rejectEvolutionDelivery,
} from "../../persistence/pg-evolution-webhook.ts";

/** أحداث Evolution تعمل كفاعل نظام وتبقى تحت عزل العيادة، دون قراءة بيانات المراجع. */
export class EvolutionWebhook {
  constructor(private readonly deps: { db: Database; clock: { now(): Date }; ids: IdGenerator }) {}

  async apply(event: EvolutionWebhookEvent): Promise<void> {
    const { db, clock, ids } = this.deps;
    await db.withTenant(event.clinicId, async (tx) => {
      const at = clock.now();
      if (event.kind === "rejected") {
        await rejectEvolutionDelivery(tx, {
          clinicId: event.clinicId,
          messageId: event.messageId,
          at,
        });
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
