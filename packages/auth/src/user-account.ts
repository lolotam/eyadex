import { runWithTransaction } from "@better-auth/core/context";

import type { AuthInstance, NewUserAccount } from "./create-auth.ts";
import { assertPassword, type AuthArea } from "./options.ts";

/**
 * الطريقة الوحيدة لإنشاء مستخدم: التسجيل الذاتي مقفول. الـ hash بيعمله Better Auth نفسه، والمستخدم
 * وصف الـ credential بيتكتبوا مع بعض.
 *
 * @param auth الـ instance اللي هيكتب (بتاع المنطقة نفسها)
 * @param area منطقة الحساب الجديد — نفس منطقة الـ instance (0024)
 * @param account الإيميل والاسم وكلمة المرور
 * @returns الـ id بتاع المستخدم الجديد
 */
export async function createAccountOn(
  auth: AuthInstance,
  area: AuthArea,
  { email, name, password }: NewUserAccount,
): Promise<{ userId: string }> {
  assertPassword(password);
  const context = await auth.$context;
  const hash = await context.password.hash(password);
  // User and credential row commit together: a failed linkAccount must not leave a user that can
  // never sign in while holding the email. TODO(spec): the global email hold (0015) belongs to
  // the identity use case that calls this (invitation acceptance, slice 2b+).
  return runWithTransaction(context.adapter, async () => {
    const user = await context.internalAdapter.createUser(
      { email: email.trim().toLowerCase(), name, emailVerified: true, area },
      { method: "admin" },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
    return { userId: user.id };
  });
}
