import type { MailProviderRequest, MailProviderView } from "@eyadex/contracts/mail-provider";
import type { MailProviderSlot } from "@eyadex/contracts/notifications";
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
import {
  keyedRequestHash,
  mailProviderView,
  slotPutRefusal,
  slotRemoveRefusal,
  splitRequest,
  testCooldownSeconds,
  type SlotRefusal,
} from "../domain/mail-provider-rules.ts";
import { publishTestRequested } from "../events/published.ts";
import {
  deleteMailProvider,
  findMailProvider,
  lastTestRequestedAt,
  lockClinicMailProvider,
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

// The primary keeps the scope the single-provider routes always used, so its alias replays as before;
// the fallback has its own, so one key sent to both slots never replays the other slot's answer.
const scopeOf = (op: "put" | "test", slot: MailProviderSlot, userId: string) =>
  slot === "primary" ? `mail_provider:${op}:${userId}` : `mail_provider:${op}:${slot}:${userId}`;

const refuse = (refusal: SlotRefusal | null): void => {
  if (refusal !== null) throw new ApiError("validation", [{ path: ["slot"], code: refusal }]);
};

// The append-only audit keeps no full phone number in any field the clinic typed: a name, an address's
// local part or an SMTP login can all be one.
const mask = (value: string | null) => (value === null ? null : maskPhonesInText(value));
const auditView = (view: MailProviderView): MailProviderView => ({
  ...view,
  fromName: maskPhonesInText(view.fromName),
  fromEmail: maskPhonesInText(view.fromEmail),
  replyTo: mask(view.replyTo),
  smtpHost: mask(view.smtpHost),
  smtpUser: mask(view.smtpUser),
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
   * بيعمل صف الخانة أو يستبدله كله (بنفس الـ id) بمفتاح `Idempotency-Key` إلزامي؛ الإعادة بترجع نفس
   * العرض من غير صف سجل تاني. الاستبدال بيصفّر `verified_at` وحالة الفشل. الاحتياطي من غير أساسي مرفوض.
   *
   * @param actor الأدمن
   * @param slot الخانة
   * @param request الجسم بعد التحقق
   * @param idempotencyKey المفتاح
   * @returns العرض بعد الكتابة
   */
  put(
    actor: MailProviderActor,
    slot: MailProviderSlot,
    request: MailProviderRequest,
    idempotencyKey: string,
  ): Promise<MailProviderView> {
    const { db, clock, ids, sealKey } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: scopeOf("put", slot, actor.userId),
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
      await lockClinicMailProvider(tx, actor.clinicId);
      const before = await findMailProvider(tx, actor.clinicId, slot, true);
      if (slot === "fallback") {
        const primary = await findMailProvider(tx, actor.clinicId, "primary");
        refuse(slotPutRefusal(slot, primary !== null));
      }
      const id = before?.id ?? ids.newId();
      const split = splitRequest(request);
      const now = clock.now();
      await upsertMailProvider(
        tx,
        actor.clinicId,
        { id, slot },
        split,
        this.#sealer.seal(split.secret, id),
        now,
      );
      const after = await findMailProvider(tx, actor.clinicId, slot);
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
          slot,
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
   * بيشيل إعداد الخانة؛ مفيش إعداد = 204 من غير سجل. من غير أساسي العيادة بترجع لبريد المنصة. الأساسي
   * مايتشالش وفيه احتياطي.
   *
   * @param actor الأدمن
   * @param slot الخانة
   * @returns `true` لو اتشال صف
   */
  remove(actor: MailProviderActor, slot: MailProviderSlot): Promise<boolean> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockClinicMailProvider(tx, actor.clinicId);
      const before = await findMailProvider(tx, actor.clinicId, slot, true);
      if (before === null) return false;
      if (slot === "primary") {
        const fallback = await findMailProvider(tx, actor.clinicId, "fallback");
        refuse(slotRemoveRefusal(slot, fallback !== null));
      }
      await deleteMailProvider(tx, actor.clinicId, before.id);
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "clinic.mail_provider_removed",
        entityType: ENTITY,
        entityId: before.id,
        details: { slot, before: auditView(mailProviderView(before)), after: null },
        createdAt: clock.now(),
      });
      return true;
    });
  }

  /**
   * بيطلب إيميل تجربة لمزود خانة (شغلانة worker): حدث outbox بـ ids والخانة بس، وصف سجل. مفيش مزود في
   * الخانة → `not_found`؛ تجربة اتقبلت للعيادة في آخر دقيقة (أي خانة) → `rate_limited` بالثواني الباقية.
   *
   * @param actor الأدمن (الرسالة بتروح لإيميل عضويته هو بس)
   * @param slot الخانة
   * @param idempotencyKey المفتاح
   * @returns id الحدث
   */
  requestTest(
    actor: MailProviderActor,
    slot: MailProviderSlot,
    idempotencyKey: string,
  ): Promise<{ eventId: string }> {
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: scopeOf("test", slot, actor.userId),
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
      await lockClinicMailProvider(tx, actor.clinicId);
      const provider = await findMailProvider(tx, actor.clinicId, slot, true);
      if (provider === null) throw new ApiError("not_found");
      // After the lock (ADR-0012 §16), from the append-only audit: two parallel requests cannot both
      // pass, and replacing or deleting the provider does not reset the limit.
      const now = clock.now();
      const wait = testCooldownSeconds(await lastTestRequestedAt(tx, actor.clinicId), now);
      if (wait > 0) throw new ApiError("rate_limited", { retryAfterSeconds: wait });
      const event = publishTestRequested(ids.newId(), now, {
        clinicId: actor.clinicId,
        providerId: provider.id,
        slot,
        providerVersion: provider.version,
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
        details: { slot },
        createdAt: now,
      });
      const response = { eventId: event.id };
      await completeClinicIdempotencyKey(tx, claim, response);
      return response;
    });
  }
}
