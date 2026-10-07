import type { MailProviderRequest, MailProviderView } from "@eyadex/contracts/mail-provider";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { maskPhonesInText } from "@eyadex/observability";
import { SecretSealer } from "@eyadex/secrets";

import { writeClinicAudit } from "../../../shared/clinic-audit.ts";
import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../shared/errors.ts";
import { requestHash } from "../../../shared/idempotency.ts";
import { appendOutboxEvent } from "../../../shared/outbox.ts";
import type { Clock } from "../../tenancy/index.ts";
import { keyedRequestHash, mailProviderView, splitRequest } from "../domain/mail-provider-rules.ts";
import { publishTestRequested } from "../events/published.ts";
import {
  deleteMailProvider,
  findMailProvider,
  upsertMailProvider,
} from "../persistence/pg-mail-provider-store.ts";

/** اللي الـ use cases محتاجينه: pool العيادة، الوقت، الـ ids، ومفتاح ختم بيانات المزود. */
export interface MailProviderDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** `MAIL_PROVIDER_SEAL_KEY` (base64، 32 بايت). */
  readonly sealKey: string;
}

/** الفاعل: عضو العيادة اللي الـ guard حلّه. */
export interface MailProviderActor {
  readonly clinicId: string;
  readonly userId: string;
}

const ENTITY = "clinic_mail_provider";

// The append-only audit keeps no full phone number, not even one typed into the sender's display name.
const auditView = (view: MailProviderView): MailProviderView => ({
  ...view,
  fromName: maskPhonesInText(view.fromName),
});

/**
 * إعداد مزود بريد العيادة (ADR-0014، 7c-2a). كل عملية transaction واحدة جوه `withTenant` فيها صف
 * سجل واحد بحقول العرض بس. السر بيتختم بـ AAD = id الصف، ومابيرجعش في أي رد أو سجل أو خطأ.
 */
export class MailProviderChanges {
  readonly #sealer: SecretSealer;

  constructor(private readonly deps: MailProviderDeps) {
    this.#sealer = new SecretSealer(deps.sealKey);
  }

  /**
   * بيعمل الصف أو يستبدله كله (بنفس الـ id) بمفتاح `Idempotency-Key` إلزامي؛ الإعادة بترجع نفس العرض
   * من غير صف سجل تاني. الاستبدال بيصفّر `verified_at` وحالة الفشل.
   *
   * @param actor الأدمن
   * @param request الجسم بعد التحقق
   * @param idempotencyKey المفتاح
   * @returns العرض بعد الكتابة
   */
  put(
    actor: MailProviderActor,
    request: MailProviderRequest,
    idempotencyKey: string,
  ): Promise<MailProviderView> {
    const { db, clock, ids, sealKey } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `mail_provider:put:${actor.userId}`,
      key: idempotencyKey,
      hash: keyedRequestHash(request, sealKey),
    };
    return db.withTenant(actor.clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<MailProviderView>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "replay") return claimed.response;
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      const before = await findMailProvider(tx, actor.clinicId, true);
      const id = before?.id ?? ids.newId();
      const split = splitRequest(request);
      const now = clock.now();
      await upsertMailProvider(
        tx,
        actor.clinicId,
        id,
        split,
        this.#sealer.seal(split.secret, id),
        now,
      );
      const after = await findMailProvider(tx, actor.clinicId);
      if (after === null) throw new Error("mail provider row vanished inside its transaction");
      const view = mailProviderView(after);
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "clinic.mail_provider_updated",
        entityType: ENTITY,
        entityId: id,
        details: {
          before: before === null ? null : auditView(mailProviderView(before)),
          after: auditView(view),
        },
        createdAt: now,
      });
      await completeClinicIdempotencyKey(tx, claim, view);
      return view;
    });
  }

  /**
   * بيشيل الإعداد؛ مفيش إعداد = 200 من غير سجل. العيادة بترجع لبريد المنصة.
   *
   * @param actor الأدمن
   * @returns `true` لو اتشال صف
   */
  remove(actor: MailProviderActor): Promise<boolean> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const before = await findMailProvider(tx, actor.clinicId, true);
      if (before === null) return false;
      await deleteMailProvider(tx, actor.clinicId, before.id);
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "clinic.mail_provider_removed",
        entityType: ENTITY,
        entityId: before.id,
        details: { before: auditView(mailProviderView(before)), after: null },
        createdAt: clock.now(),
      });
      return true;
    });
  }

  /**
   * بيطلب إيميل تجربة (شغلانة worker): حدث outbox بـ ids بس، وصف سجل. مفيش مزود → `not_found`.
   *
   * @param actor الأدمن (الرسالة بتروح لإيميل عضويته هو بس)
   * @param idempotencyKey المفتاح
   * @returns id الحدث
   */
  requestTest(actor: MailProviderActor, idempotencyKey: string): Promise<{ eventId: string }> {
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `mail_provider:test:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash({ op: "mail_provider:test" }),
    };
    return db.withTenant(actor.clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<{ eventId: string }>(
        tx,
        claim,
        ids.newId(),
        clock.now(),
      );
      if (claimed.kind === "replay") return claimed.response;
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      const provider = await findMailProvider(tx, actor.clinicId, true);
      if (provider === null) throw new ApiError("not_found");
      const now = clock.now();
      const event = publishTestRequested(ids.newId(), now, {
        clinicId: actor.clinicId,
        providerId: provider.id,
        actorUserId: actor.userId,
      });
      await appendOutboxEvent(tx, event);
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "clinic.mail_provider_test_requested",
        entityType: ENTITY,
        entityId: provider.id,
        details: {},
        createdAt: now,
      });
      const response = { eventId: event.id };
      await completeClinicIdempotencyKey(tx, claim, response);
      return response;
    });
  }
}
