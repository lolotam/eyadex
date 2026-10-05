import type { Tx } from "@eyadex/db";

/** اللي `tenancy` بيبعته لـ `identity` عشان يجهّز أول أدمن للعيادة الجديدة. */
export interface FirstAdminRequest {
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly fullName: string;
  readonly email: string;
  readonly now: Date;
}

/** النتيجة: الدعوة اتعملت (والرمز الخام للـ outbox بس)، أو الإيميل محجوز. */
export type FirstAdminResult =
  | {
      readonly kind: "invited";
      readonly invitationId: string;
      readonly expiresAt: Date;
      /** الرمز الخام: بيتقفل للـ outbox وبس — مابيتكتبش ولا بيتسجّل ولا بيرجع للعميل. */
      readonly token: string;
    }
  | { readonly kind: "email_taken" };

/**
 * Port بيعرّفه `tenancy` (صاحب العيادة) وبينفّذه `identity` (صاحب الأدوار والدعوات والإيميلات) —
 * الكتابة المتزامنة الوحيدة بين موديولين (CLAUDE.architecture.md §2.2).
 */
export interface FirstAdminProvisioner {
  /**
   * بيزرع أدوار النظام الأربعة، بيحجز الإيميل، وبيعمل دعوة أول أدمن — جوه نفس الـ transaction.
   *
   * @param tx transaction العيادة الجديدة (`withNewTenant`)
   * @param request بيانات الأدمن والفاعل
   * @returns الدعوة أو `email_taken`
   */
  provision(tx: Tx, request: FirstAdminRequest): Promise<FirstAdminResult>;
}

export const FIRST_ADMIN_PROVISIONER = Symbol("tenancy.FirstAdminProvisioner");
