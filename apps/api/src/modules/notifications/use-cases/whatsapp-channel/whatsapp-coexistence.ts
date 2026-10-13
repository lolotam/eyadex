import type { WhatsappChannelView, WhatsappCoexistenceRequest } from "@eyadex/contracts/whatsapp";
import { SecretSealer } from "@eyadex/secrets";

import type { MetaApi } from "../../ports/meta-api.ts";
import {
  channelView,
  coexistenceNeedsVerification,
  coexistenceRefusal,
  coexistenceUnchanged,
} from "../../domain/whatsapp-rules.ts";
import { findWhatsappChannel, lockWhatsappChannel } from "../../persistence/pg-whatsapp-channel.ts";
import { refuse, type WhatsappActor, type WhatsappDeps } from "./whatsapp-shared.ts";
import { withWhatsappOperation } from "./whatsapp-operation.ts";
import { refuseNumberInUse, saveCoexistence } from "./coexistence-save.ts";

/** The coexistence use case also seals the Meta token: `MAIL_PROVIDER_SEAL_KEY` (base64, 32 bytes). */
export interface WhatsappCoexistenceDeps extends WhatsappDeps {
  readonly sealKey: string;
  readonly meta: MetaApi;
}

/** What the first transaction decided. */
type Plan =
  | { readonly unchanged: true; readonly view: WhatsappChannelView }
  | {
      readonly unchanged: false;
      readonly token: string;
      readonly tokenChanged: boolean;
      readonly verify: boolean;
      readonly phoneLast4: string | null;
    };

/**
 * ربط coexistence (N-6 (b)، spec §7.1): بيانات Meta Business للعيادة مباشرة من Graph v22.0،
 * وقالب Meta لكل رسالة. التوكن write-only: بيتختم بـ AAD = id الصف، ولو اتساب في التعديل بيفضل المحفوظ،
 * ومابيرجعش في أي رد ولا سجل. البيانات بتتحقق من Meta بس لما الربط أو التوكن أو أرقام Meta تتغيّر.
 * رقم Meta بتاع عيادة تانية = `number_in_use` (N3).
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
    return withWhatsappOperation(
      this.deps,
      actor.clinicId,
      (record) => coexistenceRefusal(record, request.accessToken !== undefined),
      () => this.updateReserved(actor, request),
    );
  }

  private async updateReserved(
    actor: WhatsappActor,
    request: WhatsappCoexistenceRequest,
  ): Promise<WhatsappChannelView> {
    const { db, meta } = this.deps;
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
      await refuseNumberInUse(tx, actor.clinicId, request.phoneNumberId);
      return {
        unchanged: false,
        token,
        tokenChanged,
        verify: coexistenceNeedsVerification(before, request, tokenChanged),
        phoneLast4: before?.phoneLast4 ?? null,
      };
    });
    if (plan.unchanged) return plan.view;
    const phoneLast4 = plan.verify
      ? await meta.verify({
          accessToken: plan.token,
          phoneNumberId: request.phoneNumberId,
          businessAccountId: request.businessAccountId,
        })
      : plan.phoneLast4;
    return saveCoexistence(
      { ...this.deps, sealer: this.#sealer },
      actor,
      {
        phoneNumberId: request.phoneNumberId,
        businessAccountId: request.businessAccountId,
        templates: request.templates,
      },
      { token: plan.token, tokenChanged: plan.tokenChanged, phoneLast4 },
      "manual",
    );
  }
}
