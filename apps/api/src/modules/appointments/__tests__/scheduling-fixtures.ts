import { randomUUID } from "node:crypto";

import { APP, call, type Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";
import { addBranch } from "../../patients/__tests__/patient-fixtures.ts";

type Method = "GET" | "POST" | "PUT" | "PATCH";

/** One request on the clinic host as `cookie`; an Idempotency-Key when given. */
export const send = (
  h: Harness,
  cookie: string,
  method: Method,
  url: string,
  body?: unknown,
  key?: string,
) =>
  call(h, {
    method,
    url,
    host: APP,
    cookie,
    ...(body === undefined ? {} : { body }),
    ...(key === undefined ? {} : { headers: { "idempotency-key": key } }),
  });

export const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

/** The platform's flag for this clinic (upserted: clinics made before 0042 have no row), then the cache. */
export async function setAppointmentsModule(
  h: Harness,
  invalidate: AuthorizationInvalidator,
  clinicId: string,
  enabled: boolean,
): Promise<void> {
  await h.owner`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
                VALUES (${clinicId}, ${randomUUID()}, 'appointments', ${enabled}, now())
                ON CONFLICT (clinic_id, module) DO UPDATE SET enabled = ${enabled}, updated_at = now()`;
  await invalidate.clinicChanged(clinicId);
}

export async function membershipIdOf(h: Harness, userId: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM memberships WHERE user_id = ${userId}`;
  return row!["id"] as string;
}

export const auditOf = (h: Harness, clinicId: string, entityId: string) =>
  h.owner`SELECT action, entity_type, category, details, details::text AS raw FROM audit_log
          WHERE clinic_id = ${clinicId} AND entity_id = ${entityId} ORDER BY created_at, id`;

/**
 * A clinic with the appointments module on: the admin (every clinic key, all branches), a doctor on
 * branch D, a front desk on branch R holding view/update:schedules:branch and view:services:clinic,
 * a member holding no module key, and branch X that only the admin reaches.
 */
export async function schedulingClinic(h: Harness, invalidate: AuthorizationInvalidator) {
  const base = await clinicWithMembers(h);
  const clinicId = base.admin.clinicId;
  await setAppointmentsModule(h, invalidate, clinicId, true);
  const branchR = await addBranch(h, clinicId);
  const branchX = await addBranch(h, clinicId);
  const deskRole = await customRole(h, clinicId, [
    "view:schedules:branch",
    "update:schedules:branch",
    "view:services:clinic",
  ]);
  const desk = await memberOn(h, base.admin, deskRole, {
    allBranches: false,
    branchIds: [branchR],
  });
  const noKeys = await memberOn(
    h,
    base.admin,
    await customRole(h, clinicId, ["view:branches:clinic"]),
  );
  return {
    clinicId,
    admin: { ...base.admin, memberId: await membershipIdOf(h, base.admin.userId) },
    doctor: { ...base.doctor, memberId: await membershipIdOf(h, base.doctor.userId) },
    desk,
    noKeys,
    branchD: base.doctor.branchId,
    branchR,
    branchX,
  };
}
