import { createHash, timingSafeEqual } from "node:crypto";

import { utcDatetime } from "@eyadex/contracts/datetime-compat";
import { z } from "zod";

import { escapeHtml, type RenderedEmail } from "../../invitation-mail/domain/invitation-email.ts";

/** الحدث اللي الـ API بيكتبه لما عضو فريق المنصة يتدعى (ADR-0020). */
export const TEAM_INVITED = "platform.team_invited";

export interface TeamInviteEvent {
  readonly accountId: string;
  readonly email: string;
  readonly fullName: string;
  readonly expiresAt: string;
  readonly sealedToken: string;
}

const schema = z
  .object({
    accountId: z.string().guid(),
    email: z.string().email(),
    fullName: z.string().min(1).max(200),
    expiresAt: utcDatetime(),
    sealedToken: z.string().min(1),
  })
  .strict();

/**
 * يقرا الحمولة. حدث المنصة مالوش عيادة: صف فيه `clinic_id` → غلط.
 *
 * @param payload الحمولة
 * @param rowClinicId `clinic_id` بتاع الصف
 * @returns الحدث أو `null`
 */
export function parseTeamInvite(
  payload: unknown,
  rowClinicId: string | null,
): TeamInviteEvent | null {
  const parsed = schema.safeParse(payload);
  return parsed.success && rowClinicId === null ? parsed.data : null;
}

/** صف الحساب وقت الإرسال (مقفول `FOR SHARE`). */
export interface TeamInviteState {
  readonly status: "invited" | "active" | "deactivated";
  readonly tokenHash: string | null;
  readonly tokenExpiresAt: Date | null;
}

/**
 * سبب عدم الإرسال، أو `null` = ابعت: الحساب لسه مدعو، الرابط ماانتهاش، والـ hash بيطابق الرمز المفتوح
 * (دعوة تانية أو تعطيل بيموّت الرابط القديم).
 *
 * @param state الصف أو `null`
 * @param token الرمز بعد فتح الختم
 * @param now الوقت بعد القفل
 * @returns السبب أو `null`
 */
export function teamInviteSkip(
  state: TeamInviteState | null,
  token: string,
  now: Date,
): "missing" | "not_invited" | "expired" | "superseded" | null {
  if (state === null) return "missing";
  if (state.status !== "invited") return "not_invited";
  if (state.tokenExpiresAt === null || state.tokenExpiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  const hash = Buffer.from(createHash("sha256").update(token, "utf8").digest("hex"));
  const stored = Buffer.from(state.tokenHash ?? "");
  return stored.length === hash.length && timingSafeEqual(stored, hash) ? null : "superseded";
}

/**
 * إيميل دعوة فريق المنصة: عربي (RTL) ثم إنجليزي في رسالة واحدة، لأن حساب المنصة مالوش لغة (TODO(spec)
 * في ADR-0020). البراند `Eyadex` بالحروف اللاتينية.
 *
 * @param event الحدث
 * @param link رابط القبول على host المنصة
 * @returns الموضوع والـ HTML والنص
 */
export function renderTeamInvite(event: TeamInviteEvent, link: string): RenderedEmail {
  const name = escapeHtml(event.fullName);
  const href = escapeHtml(link);
  const button = (label: string) =>
    `<p style="margin:16px 0;"><a href="${href}" style="display:inline-block;background:#0f5e5c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;">${label}</a></p>`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#f7f6f3;font-family:'IBM Plex Sans Arabic','IBM Plex Sans',Arial,sans-serif;color:#1f2933;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ea;border-radius:8px;padding:24px;">
<p style="margin:0 0 16px;font-weight:600;">Eyadex</p>
<div dir="rtl" style="text-align:start;">
<p>مرحباً ${name}،</p>
<p>تمت دعوتك للانضمام إلى فريق منصة Eyadex. ضع كلمة مرورك، ثم فعّل التحقق بخطوتين عند أول دخول.</p>
${button("قبول الدعوة")}
<p style="color:#52606d;">ينتهي هذا الرابط خلال 7 أيام.</p>
</div>
<hr style="border:none;border-top:1px solid #e3e6ea;margin:24px 0;">
<div dir="ltr" style="text-align:start;">
<p>Hello ${name},</p>
<p>You have been invited to join the Eyadex platform team. Set your password, then turn on two-step verification at your first sign-in.</p>
${button("Accept the invitation")}
<p style="color:#52606d;">This link expires in 7 days.</p>
</div>
</div>
</body>
</html>`;
  const text = [
    `مرحباً ${event.fullName}،`,
    "تمت دعوتك للانضمام إلى فريق منصة Eyadex.",
    `قبول الدعوة: ${link}`,
    "",
    `Hello ${event.fullName},`,
    "You have been invited to join the Eyadex platform team.",
    `Accept the invitation: ${link}`,
  ].join("\n");
  return { subject: "دعوة إلى فريق منصة Eyadex · Eyadex platform team invitation", html, text };
}
