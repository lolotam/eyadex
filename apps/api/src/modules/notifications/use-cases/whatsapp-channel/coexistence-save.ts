import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
import { DatabaseError, type Tx } from "@eyadex/db";
import type { SecretSealer } from "@eyadex/secrets";

import { ApiError } from "../../../../shared/errors.ts";
import {
  channelView,
  coexistenceRefusal,
  type ChannelRecord,
  type WhatsappTemplates,
} from "../../domain/whatsapp-rules.ts";
import { whatsappClinicForPhoneNumber } from "../../persistence/pg-delivery-status.ts";
import {
  findWhatsappChannel,
  lockWhatsappChannel,
  saveWhatsappChannel,
} from "../../persistence/pg-whatsapp-channel.ts";
import { auditChannel, refuse, type WhatsappActor, type WhatsappDeps } from "./whatsapp-shared.ts";

/** What a coexistence save writes: the Meta ids, and the templates (`null` = keep the stored ones). */
export interface CoexistenceLink {
  readonly phoneNumberId: string;
  readonly businessAccountId: string;
  readonly templates: WhatsappTemplates | null;
}

/** The verified token and what the first transaction learned about it. */
export interface CoexistenceSecret {
  readonly token: string;
  readonly tokenChanged: boolean;
  readonly phoneLast4: string | null;
}

// 0059's partial unique index: one Meta number belongs to one clinic.
const NUMBER_INDEX = "clinic_whatsapp_channels_phone_number_unique";

// Never names the other clinic, never says whether it is linked now.
const numberInUse = () =>
  new ApiError("validation", [{ path: ["phoneNumberId"], code: "number_in_use" }]);

// The audit keeps the shape of the change only: never the token, never a Meta id.
const auditView = (record: ChannelRecord | null) =>
  record === null ? null : { status: record.status, templates: record.templates };

/**
 * Refuses a Meta number another clinic's coexistence channel holds, before any Meta call (0059's routing
 * lookup answers the clinic id only, which never leaves this function). The unique index still decides a
 * race and a number left on another transport's row (`saveCoexistence`).
 */
export async function refuseNumberInUse(
  tx: Tx,
  clinicId: string,
  phoneNumberId: string,
): Promise<void> {
  const holder = await whatsappClinicForPhoneNumber(tx, phoneNumberId);
  if (holder !== null && holder !== clinicId) throw numberInUse();
}

/**
 * The second transaction of a coexistence link (manual form or Embedded Signup), decided again under the
 * channel lock on the row as it is now: seal the token to the row id, keep the risk acceptance, write one
 * `clinic.whatsapp_coexistence_updated` audit row without the token or any Meta id.
 *
 * @param via `embedded_signup` adds `{ via }` to the audit details
 * @returns the channel view (`hasCredentials` only, never the token)
 */
export async function saveCoexistence(
  deps: WhatsappDeps & { readonly sealer: SecretSealer },
  actor: WhatsappActor,
  link: CoexistenceLink,
  secret: CoexistenceSecret,
  via: "manual" | "embedded_signup",
): Promise<WhatsappChannelView> {
  const { db, clock, ids, sealer } = deps;
  try {
    return await db.withTenant(actor.clinicId, async (tx) => {
      await lockWhatsappChannel(tx, actor.clinicId);
      const current = await findWhatsappChannel(tx, actor.clinicId);
      refuse(coexistenceRefusal(current, true));
      const id = current?.id ?? ids.newId();
      const now = clock.now();
      const stillLinked = current?.transport === "coexistence" && current.status === "connected";
      const record: ChannelRecord = {
        id,
        transport: "coexistence",
        status: "connected",
        instanceName: null,
        phoneLast4: secret.phoneLast4,
        riskAcceptedAt: current?.riskAcceptedAt ?? null,
        riskAcceptedBy: current?.riskAcceptedBy ?? null,
        riskVersion: current?.riskVersion ?? null,
        sealedCredentials: sealer.seal(secret.token, id),
        phoneNumberId: link.phoneNumberId,
        businessAccountId: link.businessAccountId,
        templates: link.templates ?? channelView(current).templates,
        connectedAt: stillLinked ? current.connectedAt : now,
        lastError: null,
      };
      await saveWhatsappChannel(tx, actor.clinicId, record, now);
      const details = {
        ...(via === "embedded_signup" ? { via } : {}),
        tokenChanged: secret.tokenChanged,
        before: auditView(current),
        after: auditView(record),
      };
      await auditChannel(tx, deps, actor, "clinic.whatsapp_coexistence_updated", details, now);
      return channelView(record);
    });
  } catch (error) {
    if (
      error instanceof DatabaseError &&
      error.code === "23505" &&
      error.constraint === NUMBER_INDEX
    )
      throw numberInUse();
    throw error;
  }
}
