import type { WhatsappChannelView, WhatsappCoexistenceRequest } from "@eyadex/contracts/whatsapp";
import { SecretSealer } from "@eyadex/secrets";

import { ServiceUnavailableError } from "../../../../shared/errors.ts";
import {
  channelView,
  coexistenceNeedsInstance,
  coexistenceRefusal,
  coexistenceUnchanged,
  instanceNameFor,
  type ChannelRecord,
} from "../../domain/whatsapp-rules.ts";
import {
  findWhatsappChannel,
  lockWhatsappChannel,
  saveWhatsappChannel,
} from "../../persistence/pg-whatsapp-channel.ts";
import { auditChannel, refuse, type WhatsappActor, type WhatsappDeps } from "./whatsapp-shared.ts";

/** The coexistence use case also seals the Meta token: `MAIL_PROVIDER_SEAL_KEY` (base64, 32 bytes). */
export interface WhatsappCoexistenceDeps extends WhatsappDeps {
  readonly sealKey: string;
}

/** What the first transaction decided. */
type Plan =
  | { readonly unchanged: true; readonly view: WhatsappChannelView }
  | {
      readonly unchanged: false;
      readonly token: string;
      readonly tokenChanged: boolean;
      /** The instance to delete then create again through Evolution's Business integration. */
      readonly recreate: string | null;
    };

// The audit keeps the shape of the change only: never the token, never a Meta id.
const auditView = (record: ChannelRecord | null) =>
  record === null ? null : { status: record.status, templates: record.templates };

/**
 * ربط coexistence (N-6 (b)، spec §7.1): بيانات Meta Business للعيادة من خلال تكامل Business في Evolution،
 * وقالب Meta لكل رسالة. التوكن write-only: بيتختم بـ AAD = id الصف، ولو اتساب في التعديل بيفضل المحفوظ،
 * ومابيرجعش في أي رد ولا سجل. الـ instance بيتعمل من جديد بس لما الربط أو التوكن أو أرقام Meta تتغيّر.
 */
export class WhatsappCoexistence {
  readonly #sealer: SecretSealer;

  constructor(private readonly deps: WhatsappCoexistenceDeps) {
    this.#sealer = new SecretSealer(deps.sealKey);
  }

  /**
   * بيحفظ بيانات coexistence ويخلّي القناة `connected`. رقم Evolution مربوط = رفض (يتفك الأول)؛ أول حفظ
   * من غير توكن = رفض؛ نفس القيم = نفس العرض من غير كتابة ولا سجل.
   *
   * @param actor الأدمن
   * @param request الطلب بعد `whatsappCoexistenceRequestSchema`
   * @returns القناة بعد الحفظ (`hasCredentials` بس، من غير التوكن)
   */
  async update(
    actor: WhatsappActor,
    request: WhatsappCoexistenceRequest,
  ): Promise<WhatsappChannelView> {
    const { db, evolution } = this.deps;
    if (!evolution.configured) throw new ServiceUnavailableError();
    const plan = await db.withTenant(actor.clinicId, async (tx): Promise<Plan> => {
      await lockWhatsappChannel(tx, actor.clinicId);
      const before = await findWhatsappChannel(tx, actor.clinicId);
      refuse(coexistenceRefusal(before, request.accessToken !== undefined));
      const stored =
        before?.sealedCredentials == null
          ? null
          : this.#sealer.open(before.sealedCredentials, before.id);
      const token = request.accessToken ?? stored;
      if (token === null) throw new Error("coexistence token vanished after its refusal check");
      const tokenChanged = token !== stored;
      if (coexistenceUnchanged(before, request, tokenChanged)) {
        return { unchanged: true, view: channelView(before) };
      }
      const recreate = coexistenceNeedsInstance(before, request, tokenChanged)
        ? (before?.instanceName ?? instanceNameFor(actor.clinicId))
        : null;
      return { unchanged: false, token, tokenChanged, recreate };
    });
    if (plan.unchanged) return plan.view;
    if (plan.recreate !== null) {
      await evolution.deleteInstance(plan.recreate);
      await evolution.createInstance(instanceNameFor(actor.clinicId), {
        kind: "business",
        accessToken: plan.token,
        phoneNumberId: request.phoneNumberId,
        businessAccountId: request.businessAccountId,
      });
    }
    return this.save(actor, request, plan.token, plan.tokenChanged);
  }

  // The second transaction, decided again under the lock on the row as it is now.
  private save(
    actor: WhatsappActor,
    request: WhatsappCoexistenceRequest,
    token: string,
    tokenChanged: boolean,
  ): Promise<WhatsappChannelView> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
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
        instanceName: instanceNameFor(actor.clinicId),
        phoneLast4: null,
        riskAcceptedAt: current?.riskAcceptedAt ?? null,
        riskAcceptedBy: current?.riskAcceptedBy ?? null,
        riskVersion: current?.riskVersion ?? null,
        sealedCredentials: this.#sealer.seal(token, id),
        phoneNumberId: request.phoneNumberId,
        businessAccountId: request.businessAccountId,
        templates: request.templates,
        connectedAt: stillLinked ? current.connectedAt : now,
        lastError: null,
      };
      await saveWhatsappChannel(tx, actor.clinicId, record, now);
      await auditChannel(
        tx,
        this.deps,
        actor,
        "clinic.whatsapp_coexistence_updated",
        { tokenChanged, before: auditView(current), after: auditView(record) },
        now,
      );
      return channelView(record);
    });
  }
}
