import { createHmac } from "node:crypto";
import { legacyNumber } from "@eyadex/contracts/number-compat";
import { legacyInteger } from "@eyadex/contracts/integer-compat";
import { z } from "zod";

import { metaDeliveryFailureCode, type DeliveryUpdate } from "./delivery-status.ts";
import { webhookAuthenticated } from "./webhook-authentication.ts";

/** The statuses Meta reported for one of its numbers (`value.metadata.phone_number_id`). */
export interface MetaStatusBatch {
  readonly phoneNumberId: string;
  readonly updates: readonly { readonly messageId: string; readonly update: DeliveryUpdate }[];
}

// Zod strips every field it does not name: nothing else of Meta's body (messages, contacts, texts)
// reaches the use case.
const change = z.object({
  value: z.object({
    metadata: z.object({ phone_number_id: z.string().regex(/^\d{5,30}$/) }),
    statuses: z.array(z.unknown()).optional(),
  }),
});
const status = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  // A malformed time does not drop the status: it is dated at receipt (eventTime).
  timestamp: z.unknown().optional(),
  errors: z.array(z.object({ code: legacyNumber().check(legacyInteger()).optional() })).optional(),
});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined;

// Meta's event time, never later than ours: a provider clock ahead of ours must not date a read in the future.
const eventTime = (timestamp: unknown, now: Date): Date => {
  const at =
    typeof timestamp === "string" && /^\d{1,12}$/.test(timestamp) ? Number(timestamp) * 1000 : NaN;
  return Number.isFinite(at) && at <= now.getTime() ? new Date(at) : now;
};

/**
 * يقرا حالات الرسايل من جسم webhook بتاع Meta بعد التحقق من التوقيع (spec §7.2)، ويهمل أي حاجة تانية
 * (`messages`، حقول مجهولة، حالة شكلها غلط). `sent` مابيغيّرش حاجة لأن الدفتر عارف وقت القبول.
 *
 * @param body الجسم بعد `JSON.parse`، غير موثوق في شكله
 * @param now وقت الاستلام، الحد الأقصى لوقت أي حدث
 * @returns حالات كل رقم
 */
export function parseMetaWebhook(body: unknown, now: Date): MetaStatusBatch[] {
  const batches: MetaStatusBatch[] = [];
  for (const entry of list(field(body, "entry"))) {
    for (const raw of list(field(entry, "changes"))) {
      const parsed = change.safeParse(raw);
      if (!parsed.success) continue;
      const updates = list(parsed.data.value.statuses).flatMap((item) => {
        const s = status.safeParse(item);
        if (!s.success || s.data.status === "sent") return [];
        const at = eventTime(s.data.timestamp, now);
        const update: DeliveryUpdate =
          s.data.status === "failed"
            ? { kind: "failed", code: metaDeliveryFailureCode(s.data.errors?.[0]?.code ?? null) }
            : { kind: s.data.status, at };
        return [{ messageId: s.data.id, update }];
      });
      if (updates.length > 0)
        batches.push({ phoneNumberId: parsed.data.value.metadata.phone_number_id, updates });
    }
  }
  return batches;
}

/**
 * توقيع Meta على البايتات الخام زي ما وصلت (`X-Hub-Signature-256: sha256=<hex>`)، بمقارنة ثابتة الوقت.
 *
 * @param raw الجسم الخام قبل أي تحليل
 * @param header قيمة الهيدر
 * @param appSecret سر التطبيق
 * @returns هل التوقيع صحيح
 */
export function metaSignatureValid(raw: Buffer, header: unknown, appSecret: string): boolean {
  const expected = `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  return webhookAuthenticated(header, expected);
}

// What Meta sends as the challenge is a short token; anything else is never echoed back.
const CHALLENGE = /^[A-Za-z0-9._-]{1,256}$/;

/**
 * تحقق اشتراك الـ webhook (`GET`): `hub.mode = subscribe` والتوكن بمقارنة ثابتة الوقت.
 *
 * @param query الـ query string بعد Fastify (المفاتيح بالنقطة زي ما هي)
 * @param verifyToken `META_WEBHOOK_VERIFY_TOKEN`
 * @returns الـ challenge اللي يترد، أو `null` = 403
 */
export function metaChallenge(query: unknown, verifyToken: string): string | null {
  const mode = field(query, "hub.mode");
  const token = field(query, "hub.verify_token");
  const challenge = field(query, "hub.challenge");
  const tokenMatches = webhookAuthenticated(token, verifyToken);
  if (mode !== "subscribe" || !tokenMatches) return null;
  return typeof challenge === "string" && CHALLENGE.test(challenge) ? challenge : null;
}
