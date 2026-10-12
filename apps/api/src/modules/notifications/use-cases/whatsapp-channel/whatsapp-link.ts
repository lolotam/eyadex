import type {
  WhatsappChannelView,
  WhatsappConnectRequest,
  WhatsappQrResponse,
} from "@eyadex/contracts/whatsapp";

import { ServiceUnavailableError } from "../../../../shared/errors.ts";
import {
  channelView,
  evolutionLinkRefusal,
  instanceNameFor,
  riskToRecord,
  type ChannelRecord,
} from "../../domain/whatsapp-rules.ts";
import type { EvolutionConnectResult } from "../../ports/evolution-api.ts";
import {
  findWhatsappChannel,
  lockWhatsappChannel,
  saveWhatsappChannel,
} from "../../persistence/pg-whatsapp-channel.ts";
import {
  auditChannel,
  emptyChannel,
  refuse,
  type WhatsappActor,
  type WhatsappDeps,
} from "./whatsapp-shared.ts";

/** What Evolution answered once the instance exists. */
type LinkResult = Exclude<EvolutionConnectResult, { state: "missing" }>;

const NOT_LINKED: WhatsappQrResponse = { status: "disconnected", qrDataUrl: null };
const LINKED: WhatsappQrResponse = { status: "connected", qrDataUrl: null };

/** What the first transaction of a connect decided. */
type ConnectStart =
  | { readonly linked: true }
  | {
      readonly linked: false;
      readonly instanceName: string;
      /** An Evolution instance of this clinic exists for the Baileys link already. */
      readonly hasInstance: boolean;
      /** An instance left by another transport, to delete before creating the Baileys one. */
      readonly staleInstance: string | null;
    };

/**
 * ربط رقم العيادة بـ Evolution بالـ QR (N-6 (a)، spec §7.1): قبول المخاطرة (مرة لكل نسخة من النص،
 * متسجّل)، عمل الـ instance لو مش موجود، الـ QR، تحديث الحالة لحد ما يبقى `connected`، وفك الربط. مفيش
 * transaction ماسكة قفل وقت الكلام مع Evolution: قرار تحت القفل ← الشبكة ← كتابة تحت القفل.
 */
export class WhatsappLink {
  constructor(private readonly deps: WhatsappDeps) {}

  /**
   * قناة العيادة كما هي محفوظة (من غير توكن ولا رقم كامل).
   *
   * @param clinicId العيادة
   * @returns العرض
   */
  view(clinicId: string): Promise<WhatsappChannelView> {
    return this.deps.db.withTenant(clinicId, async (tx) =>
      channelView(await findWhatsappChannel(tx, clinicId)),
    );
  }

  /**
   * بيسجّل قبول المخاطرة لو لسه ماتسجلش، يعمل instance الـ Baileys لو مش موجود، ويرجّع الـ QR. رقم مربوط
   * بالفعل = `connected` من غير أي طلب لـ Evolution؛ رقم coexistence مربوط = رفض.
   *
   * @param actor الأدمن
   * @param request قبول المخاطرة بنسختها
   * @returns الحالة والـ QR
   */
  async connect(
    actor: WhatsappActor,
    request: WhatsappConnectRequest,
  ): Promise<WhatsappQrResponse> {
    const { db, clock, ids, evolution } = this.deps;
    if (!evolution.configured) throw new ServiceUnavailableError();
    const start = await db.withTenant(actor.clinicId, async (tx): Promise<ConnectStart> => {
      await lockWhatsappChannel(tx, actor.clinicId);
      const before = await findWhatsappChannel(tx, actor.clinicId);
      refuse(evolutionLinkRefusal(before));
      if (before?.transport === "evolution" && before.status === "connected")
        return { linked: true };
      if (riskToRecord(before)) {
        const now = clock.now();
        const record: ChannelRecord = {
          ...(before ?? emptyChannel(ids.newId())),
          riskAcceptedAt: now,
          riskAcceptedBy: actor.userId,
          riskVersion: request.riskVersion,
        };
        await saveWhatsappChannel(tx, actor.clinicId, record, now);
        await auditChannel(
          tx,
          this.deps,
          actor,
          "clinic.whatsapp_risk_accepted",
          { riskVersion: request.riskVersion },
          now,
        );
      }
      const own = before?.transport === "evolution" ? before.instanceName : null;
      return {
        linked: false,
        instanceName: own ?? instanceNameFor(actor.clinicId),
        hasInstance: own !== null,
        staleInstance: own === null ? (before?.instanceName ?? null) : null,
      };
    });
    if (start.linked) return LINKED;
    if (start.staleInstance !== null) await evolution.deleteInstance(start.staleInstance);
    if (!start.hasInstance) await evolution.createInstance(start.instanceName, { kind: "baileys" });
    return this.settle(actor, start.instanceName, await this.connectOrCreate(start.instanceName));
  }

  /**
   * تحديث الـ QR وقت ما الشاشة بتسأل: بيقرا `connectionState`، ولو اتفتح بيحوّل `pending` لـ `connected`
   * بآخر 4 أرقام. قناة مش بتتربط بالـ QR دلوقتي بترجع حالتها من غير أي طلب لـ Evolution.
   *
   * @param actor الأدمن
   * @returns الحالة والـ QR
   */
  async refresh(actor: WhatsappActor): Promise<WhatsappQrResponse> {
    const { db, evolution } = this.deps;
    const record = await db.withTenant(actor.clinicId, (tx) =>
      findWhatsappChannel(tx, actor.clinicId),
    );
    if (record === null) return NOT_LINKED;
    const name = record.instanceName;
    if (record.transport !== "evolution" || record.status !== "pending" || name === null) {
      return { status: record.status, qrDataUrl: null };
    }
    if (!evolution.configured) throw new ServiceUnavailableError();
    const state = await evolution.connectionState(name);
    const result: LinkResult =
      state === "open" ? { state: "open" } : await this.connectOrCreate(name);
    return this.settle(actor, name, result);
  }

  /**
   * فك الربط: Evolution بيعمل logout (و coexistence بيتمسح الـ instance بتاعه)، والصف يبقى `disconnected`
   * بسجل تدقيق. قناة مش مربوطة = نفس العرض من غير كتابة. لو Evolution مش متظبط الصف بس بيتصفّر.
   *
   * @param actor الأدمن
   * @returns القناة بعد فك الربط
   */
  async disconnect(actor: WhatsappActor): Promise<WhatsappChannelView> {
    const { db, clock, evolution } = this.deps;
    const before = await db.withTenant(actor.clinicId, (tx) =>
      findWhatsappChannel(tx, actor.clinicId),
    );
    if (before === null || before.status === "disconnected") return channelView(before);
    let deleted = false;
    if (evolution.configured && before.instanceName !== null) {
      if (before.transport === "coexistence") {
        await evolution.deleteInstance(before.instanceName);
        deleted = true;
      } else {
        await evolution.logout(before.instanceName);
      }
    }
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockWhatsappChannel(tx, actor.clinicId);
      const current = await findWhatsappChannel(tx, actor.clinicId);
      if (current === null || current.status === "disconnected") return channelView(current);
      const now = clock.now();
      const record: ChannelRecord = {
        ...current,
        status: "disconnected",
        phoneLast4: null,
        connectedAt: null,
        lastError: null,
        instanceName: deleted ? null : current.instanceName,
      };
      await saveWhatsappChannel(tx, actor.clinicId, record, now);
      await auditChannel(
        tx,
        this.deps,
        actor,
        "clinic.whatsapp_disconnected",
        { transport: current.transport },
        now,
      );
      return channelView(record);
    });
  }

  // `instance/connect`; an instance Evolution no longer knows is created once more, then asked again.
  private async connectOrCreate(name: string): Promise<LinkResult> {
    const first = await this.deps.evolution.connect(name);
    if (first.state !== "missing") return first;
    await this.deps.evolution.createInstance(name, { kind: "baileys" });
    const second = await this.deps.evolution.connect(name);
    if (second.state === "missing") throw new ServiceUnavailableError();
    return second;
  }

  // The second transaction: the row becomes `pending` with the instance, or `connected` with the last
  // four digits and one audit row — decided again under the lock, on the row as it is now.
  private async settle(
    actor: WhatsappActor,
    instanceName: string,
    result: LinkResult,
  ): Promise<WhatsappQrResponse> {
    const { db, clock, evolution } = this.deps;
    const open = result.state === "open";
    const last4 = open ? await evolution.ownerLast4(instanceName) : null;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockWhatsappChannel(tx, actor.clinicId);
      const current = await findWhatsappChannel(tx, actor.clinicId);
      refuse(evolutionLinkRefusal(current));
      if (current === null) return NOT_LINKED;
      if (current.transport === "evolution" && current.status === "connected") return LINKED;
      const now = clock.now();
      await saveWhatsappChannel(
        tx,
        actor.clinicId,
        {
          ...current,
          transport: "evolution",
          instanceName,
          status: open ? "connected" : "pending",
          phoneLast4: last4,
          connectedAt: open ? now : null,
          lastError: null,
        },
        now,
      );
      if (!open) return { status: "pending", qrDataUrl: result.qrDataUrl };
      await auditChannel(
        tx,
        this.deps,
        actor,
        "clinic.whatsapp_connected",
        { transport: "evolution" },
        now,
      );
      return LINKED;
    });
  }
}
