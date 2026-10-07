import { createHash, timingSafeEqual } from "node:crypto";

import type { InvitationState } from "../ports/invitation-state-reader.ts";

/** ليه الحدث ما اتبعتش. بيتسجّل كما هو، فمفيش فيه أي بيانات. */
export type SkipReason = "missing" | "accepted" | "cancelled" | "expired" | "superseded";

/**
 * فحص وقت الإرسال (ADR-0012 §8): الدعوة لسه `pending`، ما انتهتش عند `now`، والرمز اللي في الحدث هو
 * الرمز الحالي (`sha256(token) = token_hash`). أي resend أو نسخ رابط بعد الحدث بيخلّيه `superseded`.
 *
 * @param state حالة الدعوة دلوقتي، أو `null` لو مش موجودة
 * @param token الرمز اللي اتفتح من `sealedToken`
 * @param now وقت القرار (بعد قراءة الحالة)
 * @returns `null` لو يتبعت، أو سبب التخطي
 */
export function skipReason(
  state: InvitationState | null,
  token: string,
  now: Date,
): SkipReason | null {
  if (state === null) return "missing";
  if (state.status === "accepted") return "accepted";
  if (state.status === "cancelled") return "cancelled";
  if (state.expiresAt.getTime() <= now.getTime()) return "expired";
  const actual = Buffer.from(createHash("sha256").update(token, "utf8").digest("hex"), "utf8");
  const stored = Buffer.from(state.tokenHash, "utf8");
  if (actual.length !== stored.length || !timingSafeEqual(actual, stored)) return "superseded";
  return null;
}
