import { randomUUID } from "node:crypto";

import { APP, call, type Harness } from "../auth/__tests__/auth-http-harness.ts";

export const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

/** POST /v1/branches with a fresh (or given) Idempotency-Key. */
export const createBranch = (
  h: Harness,
  cookie: string | undefined,
  body: Record<string, unknown> = { nameAr: "فرع", nameEn: `Branch ${randomUUID().slice(0, 8)}` },
  key: string = randomUUID(),
  host = APP,
) =>
  call(h, {
    url: "/v1/branches",
    host,
    body,
    headers: { "idempotency-key": key },
    ...(cookie === undefined ? {} : { cookie }),
  });

export const branchAction = (
  h: Harness,
  cookie: string | undefined,
  id: string,
  action: "deactivate" | "reactivate",
  host = APP,
  body?: Record<string, unknown>,
) =>
  call(h, {
    url: `/v1/branches/${id}/${action}`,
    host,
    ...(body === undefined ? {} : { body }),
    ...(cookie === undefined ? {} : { cookie }),
  });

export const patchBranch = (
  h: Harness,
  cookie: string | undefined,
  id: string,
  body: Record<string, unknown>,
  host = APP,
) =>
  call(h, {
    method: "PATCH",
    url: `/v1/branches/${id}`,
    host,
    body,
    ...(cookie === undefined ? {} : { cookie }),
  });

export async function activeBranchIds(h: Harness, clinicId: string): Promise<string[]> {
  const rows =
    await h.owner`SELECT id FROM branches WHERE clinic_id = ${clinicId} AND is_active ORDER BY id`;
  return rows.map((r) => r["id"] as string);
}

export const setMaxBranches = (h: Harness, clinicId: string, max: number) =>
  h.owner`UPDATE clinics SET max_branches = ${max} WHERE id = ${clinicId}`;

export async function branchAudit(h: Harness, clinicId: string, branchId: string) {
  return h.owner`SELECT action, category, actor_user_id, details FROM audit_log
                 WHERE clinic_id = ${clinicId} AND entity_type = 'branch' AND entity_id = ${branchId}
                 ORDER BY created_at, id`;
}
