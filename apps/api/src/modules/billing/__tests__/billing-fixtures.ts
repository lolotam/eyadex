import type { Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn, setMaxUsers } from "../../identity/__tests__/user-fixtures.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";
import { bookingClinic } from "../../appointments/__tests__/appointment-fixtures.ts";
import { setModule } from "../../medical/__tests__/medical-fixtures.ts";

/**
 * The booking clinic with the finance module on. The admin holds the seven clinic-scope finance keys from
 * the onboarding (system-roles.ts); a price reader on every branch holds `view:prices:clinic` only.
 */
export async function financeClinic(h: Harness, invalidate: AuthorizationInvalidator) {
  const C = await bookingClinic(h, invalidate);
  await setMaxUsers(h, C.clinicId, 50);
  await setModule(h, invalidate, C.clinicId, "finance", true);
  const priceReader = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, ["view:prices:clinic", "view:services:clinic"]),
  );
  await invalidate.clinicChanged(C.clinicId);
  return { ...C, priceReader };
}

export type FinanceClinic = Awaited<ReturnType<typeof financeClinic>>;

/** The clinic's audit rows written since `since`, oldest first. */
export const auditSince = (h: Harness, clinicId: string, since: Date) =>
  h.owner`SELECT action, category, entity_type, entity_id, details FROM audit_log
          WHERE clinic_id = ${clinicId} AND created_at >= ${since} ORDER BY created_at, id`;
