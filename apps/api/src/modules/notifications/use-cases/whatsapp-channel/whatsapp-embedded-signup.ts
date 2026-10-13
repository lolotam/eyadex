import type {
  WhatsappChannelView,
  WhatsappEmbeddedSignupRequest,
  WhatsappSignupConfig,
} from "@eyadex/contracts/whatsapp";
import { SecretSealer } from "@eyadex/secrets";

import { ApiError } from "../../../../shared/errors.ts";
import { coexistenceRefusal } from "../../domain/whatsapp-rules.ts";
import type { MetaAppConfig } from "../../persistence/meta-config.ts";
import { findWhatsappChannel, lockWhatsappChannel } from "../../persistence/pg-whatsapp-channel.ts";
import { META_GRAPH_VERSION, type MetaApi } from "../../ports/meta-api.ts";
import { refuseNumberInUse, saveCoexistence } from "./coexistence-save.ts";
import { refuse, type WhatsappActor, type WhatsappDeps } from "./whatsapp-shared.ts";
import { withWhatsappOperation } from "./whatsapp-operation.ts";

/** Embedded Signup needs the Meta app (all four META_ variables) and the seal key of the manual form. */
export interface WhatsappEmbeddedSignupDeps extends WhatsappDeps {
  readonly sealKey: string;
  readonly meta: MetaApi;
  readonly app: MetaAppConfig | null;
}

// Both features are off without the Meta app: the browser shows the manual form only.
const unavailable = () => new ApiError("not_found", [{ path: [], code: "unavailable" }]);

/**
 * Embedded Signup بتاع Meta للـ coexistence بس (N3، spec §7.2): المتصفح بيفتح نافذة Meta وبيرجّع كود مرة
 * واحدة وأرقام Meta؛ الـ API بيبدّل الكود بالتوكن (السر مابيسيبش الـ API)، ويعمل نفس فحوص الفورم اليدوي
 * (قراءة الرقم، `subscribed_apps`)، ويختم التوكن ويحفظ بنفس قواعد `PUT /coexistence`، والقوالب زي ما هي.
 * عمره ما بينده `/register` ولا `smb_app_data`.
 */
export class WhatsappEmbeddedSignup {
  readonly #sealer: SecretSealer;

  constructor(private readonly deps: WhatsappEmbeddedSignupDeps) {
    this.#sealer = new SecretSealer(deps.sealKey);
  }

  /**
   * اللي المتصفح محتاجه يفتح Embedded Signup: أرقام عامة بس.
   *
   * @returns رقم التطبيق ورقم الإعداد وإصدار Graph، أو 404 `unavailable`
   */
  signupConfig(): WhatsappSignupConfig {
    const { app } = this.deps;
    if (app === null) throw unavailable();
    return { appId: app.appId, configId: app.configId, graphVersion: META_GRAPH_VERSION };
  }

  /**
   * بيكمّل الربط بالكود اللي رجع من `FB.login`. رقم Evolution مربوط = `evolution_linked`؛ رقم عيادة تانية =
   * `number_in_use`؛ Meta رفض الكود = `meta_code_invalid`؛ التحقق بخطوتين شغّال = `meta_two_step_enabled`؛
   * الشبكة أو 5xx = 503.
   *
   * @param actor الأدمن
   * @param request الطلب بعد `whatsappEmbeddedSignupRequestSchema`
   * @returns القناة بعد الحفظ (`hasCredentials` بس، من غير التوكن)
   */
  async complete(
    actor: WhatsappActor,
    request: WhatsappEmbeddedSignupRequest,
  ): Promise<WhatsappChannelView> {
    const { app } = this.deps;
    if (app === null) throw unavailable();
    return withWhatsappOperation(
      this.deps,
      actor.clinicId,
      (record) => coexistenceRefusal(record, true),
      () => this.completeReserved(actor, request, app),
    );
  }

  private async completeReserved(
    actor: WhatsappActor,
    request: WhatsappEmbeddedSignupRequest,
    app: MetaAppConfig,
  ): Promise<WhatsappChannelView> {
    const { db, meta } = this.deps;
    await db.withTenant(actor.clinicId, async (tx) => {
      await lockWhatsappChannel(tx, actor.clinicId);
      refuse(coexistenceRefusal(await findWhatsappChannel(tx, actor.clinicId), true));
      await refuseNumberInUse(tx, actor.clinicId, request.phoneNumberId);
    });
    // The port gets the app's id and secret only, never the verify token.
    const token = await meta.exchangeCode(request.code, {
      appId: app.appId,
      appSecret: app.appSecret,
    });
    const phoneLast4 = await this.verified(token, request);
    return saveCoexistence(
      { ...this.deps, sealer: this.#sealer },
      actor,
      { phoneNumberId: request.phoneNumberId, businessAccountId: request.wabaId, templates: null },
      { token, tokenChanged: true, phoneLast4 },
      "embedded_signup",
    );
  }

  // The token is Meta's own, minted a moment ago: a refusal of it here means the ids the browser sent do
  // not belong to it, so the answer names the number, not a token field this request does not have.
  private async verified(token: string, request: WhatsappEmbeddedSignupRequest): Promise<string> {
    try {
      return await this.deps.meta.verify({
        accessToken: token,
        phoneNumberId: request.phoneNumberId,
        businessAccountId: request.wabaId,
      });
    } catch (error) {
      const details = error instanceof ApiError ? error.details : undefined;
      if (
        Array.isArray(details) &&
        (details[0] as { code?: unknown } | undefined)?.code === "meta_credentials_invalid"
      )
        throw new ApiError("validation", [
          { path: ["phoneNumberId"], code: "meta_credentials_invalid" },
        ]);
      throw error;
    }
  }
}
