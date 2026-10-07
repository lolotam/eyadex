import { z } from "zod";

/** الأحداث اللي الـ dispatcher ده بيبعتها؛ أي نوع تاني بيفضل في الـ outbox لـ slice تاني. */
export const ADMIN_INVITED = "clinic.admin_invited";
export const USER_INVITED = "clinic.user_invited";
export const INVITATION_EVENT_TYPES = [ADMIN_INVITED, USER_INVITED] as const;

const base = {
  clinicId: z.string().uuid(),
  invitationId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().min(1),
  language: z.enum(["ar", "en"]),
  clinicNameAr: z.string().min(1),
  clinicNameEn: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  sealedToken: z.string().min(1),
};

const adminInvited = z.object(base);
const userInvited = z.object({
  ...base,
  roleNameAr: z.string().min(1),
  roleNameEn: z.string().min(1),
});

/** payload حدث دعوة بعد التحقق. `role` موجود في دعوة المستخدم بس. */
export interface InvitationEvent {
  readonly clinicId: string;
  readonly invitationId: string;
  readonly email: string;
  readonly fullName: string;
  readonly language: "ar" | "en";
  readonly clinicName: { readonly ar: string; readonly en: string };
  readonly role: { readonly ar: string; readonly en: string } | null;
  readonly sealedToken: string;
}

/**
 * بيتحقق من payload حدث دعوة. الحدثين بيكتبهم الـ API، فالفشل هنا معناه payload بايظ مش حالة عادية.
 *
 * @param type نوع الحدث
 * @param payload الـ payload زي ما اتقرا
 * @returns الحدث، أو `null` لو الشكل غلط
 */
export function parseInvitationEvent(type: string, payload: unknown): InvitationEvent | null {
  if (type === USER_INVITED) {
    const parsed = userInvited.safeParse(payload);
    if (!parsed.success) return null;
    const p = parsed.data;
    return { ...common(p), role: { ar: p.roleNameAr, en: p.roleNameEn } };
  }
  if (type === ADMIN_INVITED) {
    const parsed = adminInvited.safeParse(payload);
    return parsed.success ? { ...common(parsed.data), role: null } : null;
  }
  return null;
}

const common = (p: z.output<typeof adminInvited>) => ({
  clinicId: p.clinicId,
  invitationId: p.invitationId,
  email: p.email,
  fullName: p.fullName,
  language: p.language,
  clinicName: { ar: p.clinicNameAr, en: p.clinicNameEn },
  sealedToken: p.sealedToken,
});
