import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  templatesOf,
  type ChannelRecord,
  type ChannelRefusal,
} from "../../domain/whatsapp-rules.ts";
import type { EvolutionApi } from "../../ports/evolution-api.ts";

/** What the WhatsApp use cases need: the clinic pool, the time, ids and the Evolution port. */
export interface WhatsappDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly evolution: EvolutionApi;
}

/** The admin the guard resolved. */
export interface WhatsappActor {
  readonly clinicId: string;
  readonly userId: string;
}

/** A refusal decided under the channel lock: `validation`, one detail. */
export function refuse(refusal: ChannelRefusal | null): void {
  if (refusal !== null) {
    throw new ApiError("validation", [{ path: [refusal.path], code: refusal.code }]);
  }
}

/** A channel row for a clinic that never had one: unlinked, nothing accepted, nothing stored. */
export function emptyChannel(id: string): ChannelRecord {
  return {
    id,
    transport: null,
    status: "disconnected",
    instanceName: null,
    phoneLast4: null,
    riskAcceptedAt: null,
    riskAcceptedBy: null,
    riskVersion: null,
    sealedCredentials: null,
    phoneNumberId: null,
    businessAccountId: null,
    templates: templatesOf({}),
    connectedAt: null,
    lastError: null,
  };
}

/**
 * One administrative audit row on the clinic entity (like `clinic.notification_settings_updated`). The
 * details never carry the token or the number.
 */
export async function auditChannel(
  tx: Tx,
  deps: Pick<WhatsappDeps, "ids">,
  actor: WhatsappActor,
  action:
    | "clinic.whatsapp_risk_accepted"
    | "clinic.whatsapp_connected"
    | "clinic.whatsapp_disconnected"
    | "clinic.whatsapp_coexistence_updated",
  details: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await writeClinicAudit(tx, {
    clinicId: actor.clinicId,
    id: deps.ids.newId(),
    actorUserId: actor.userId,
    action,
    entityType: "clinic",
    entityId: actor.clinicId,
    details,
    createdAt: now,
  });
}
