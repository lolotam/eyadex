import { randomUUID } from "node:crypto";

import { APP, call, type Harness } from "../auth/__tests__/auth-http-harness.ts";

/** A unique pair of names, so no test trips over another's role. */
export const names = (label = "Role") => {
  const tag = randomUUID().slice(0, 8);
  return { nameAr: `دور ${tag}`, nameEn: `${label} ${tag}` };
};

/** POST /v1/roles with a fresh (or given) Idempotency-Key. */
export const createRole = (
  h: Harness,
  cookie: string | undefined,
  body: Record<string, unknown> = { ...names(), permissionKeys: [] },
  key: string = randomUUID(),
  host = APP,
) =>
  call(h, {
    url: "/v1/roles",
    host,
    body,
    headers: key === "" ? {} : { "idempotency-key": key },
    ...(cookie === undefined ? {} : { cookie }),
  });

export const patchRole = (
  h: Harness,
  cookie: string | undefined,
  id: string,
  body: Record<string, unknown>,
  host = APP,
) =>
  call(h, {
    method: "PATCH",
    url: `/v1/roles/${id}`,
    host,
    body,
    ...(cookie === undefined ? {} : { cookie }),
  });

export const roleAction = (
  h: Harness,
  cookie: string | undefined,
  id: string,
  action: "deactivate" | "reactivate",
  host = APP,
) =>
  call(h, {
    url: `/v1/roles/${id}/${action}`,
    host,
    ...(cookie === undefined ? {} : { cookie }),
  });

/** The role row and its keys, read as the owner. */
export async function roleRow(h: Harness, id: string) {
  const [row] = await h.owner`SELECT name_ar, name_en, is_active FROM roles WHERE id = ${id}`;
  const keys = await h.owner`SELECT p.key FROM role_permissions rp
                             JOIN permissions p ON p.id = rp.permission_id
                             WHERE rp.role_id = ${id} ORDER BY p.key`;
  return {
    name_ar: row!["name_ar"] as string,
    name_en: row!["name_en"] as string,
    is_active: row!["is_active"] as boolean,
    keys: keys.map((k) => k["key"] as string),
  };
}

export const roleAudit = (h: Harness, clinicId: string, roleId: string) =>
  h.owner`SELECT action, category, actor_user_id, details FROM audit_log
          WHERE clinic_id = ${clinicId} AND entity_type = 'role' AND entity_id = ${roleId}
          ORDER BY created_at, id`;

export const setPatientsModule = (h: Harness, clinicId: string, enabled: boolean) =>
  h.owner`UPDATE clinic_features SET enabled = ${enabled}, updated_at = now()
          WHERE clinic_id = ${clinicId} AND module = 'patients'`;
