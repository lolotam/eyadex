import { randomUUID } from "node:crypto";

import { SecretSealer } from "@eyadex/secrets";
import { APP, call, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { signedIn } from "./access-fixtures.ts";
import { accept, strongPassword } from "./invitation-fixtures.ts";

export const roleIdOf = async (h: Harness, clinicId: string, key: string) => {
  const [row] =
    await h.owner`SELECT id FROM roles WHERE clinic_id = ${clinicId} AND system_key = ${key}`;
  return row!["id"] as string;
};

/** A custom role holding exactly these permission keys (written as the owner). */
export async function customRole(h: Harness, clinicId: string, keys: readonly string[]) {
  const id = randomUUID();
  await h.owner`INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active,
                  created_at, updated_at)
                VALUES (${clinicId}, ${id}, NULL, ${`دور ${id.slice(0, 6)}`}, ${`Role ${id.slice(0, 6)}`},
                  false, true, now(), now())`;
  for (const key of keys) {
    await h.owner`INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
                  SELECT ${clinicId}, ${randomUUID()}, ${id}, p.id, now() FROM permissions p
                  WHERE p.key = ${key}`;
  }
  return id;
}

export const setMaxUsers = (h: Harness, clinicId: string, max: number) =>
  h.owner`UPDATE clinics SET max_users = ${max} WHERE id = ${clinicId}`;

export const inviteBody = (roleId: string, extra: Record<string, unknown> = {}) => ({
  fullName: "Invited Person",
  email: `person-${randomUUID().slice(0, 8)}@example.test`,
  roleId,
  allBranches: true,
  branchIds: [],
  ...extra,
});

export const invite = (
  h: Harness,
  cookie: string | undefined,
  body: Record<string, unknown>,
  key: string = randomUUID(),
  host = APP,
) =>
  call(h, {
    url: "/v1/invitations",
    host,
    body,
    headers: { "idempotency-key": key },
    ...(cookie === undefined ? {} : { cookie }),
  });

/** POST/PATCH on /v1/<path> with the member's cookie. */
export const act = (
  h: Harness,
  cookie: string | undefined,
  url: string,
  body?: Record<string, unknown>,
  method: "POST" | "PATCH" = "POST",
  host = APP,
) =>
  call(h, {
    method,
    url,
    host,
    ...(body === undefined ? {} : { body }),
    ...(cookie === undefined ? {} : { cookie }),
  });

/** The outbox rows of one invitation, newest last. */
export const invitationEvents = (h: Harness, invitationId: string) =>
  h.owner`SELECT id, event_type, payload, payload::text AS raw FROM outbox_events
          WHERE payload->>'invitationId' = ${invitationId} ORDER BY created_at, id`;

/** Opens the newest event's sealed token, as the future dispatcher will (ADR-0006). */
export async function latestToken(h: Harness, invitationId: string): Promise<string> {
  const events = await invitationEvents(h, invitationId);
  const event = events.at(-1)!;
  const payload = event["payload"] as { sealedToken: string };
  return new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!).open(
    payload.sealedToken,
    event["id"] as string,
  );
}

/** Invites through the API, accepts with the sealed token and signs in: a real member on `roleId`. */
export async function memberOn(
  h: Harness,
  admin: { clinicId: string; cookie: string },
  roleId: string,
  extra: Record<string, unknown> = {},
) {
  const body = inviteBody(roleId, extra);
  const res = await invite(h, admin.cookie, body);
  if (res.statusCode !== 201) throw new Error(`invite failed: ${res.statusCode} ${res.body}`);
  const invitationId = (res.json() as { id: string }).id;
  const password = strongPassword();
  const accepted = await accept(h, await latestToken(h, invitationId), password);
  if (accepted.statusCode !== 200) throw new Error(`accept failed: ${accepted.statusCode}`);
  const member = await signedIn(h, admin.clinicId, body.email, password);
  const [row] = await h.owner`SELECT id FROM memberships WHERE user_id = ${member.userId}`;
  return { ...member, memberId: row!["id"] as string, password };
}

export const audit = (h: Harness, clinicId: string, entityId: string) =>
  h.owner`SELECT action, details, details::text AS raw FROM audit_log
          WHERE clinic_id = ${clinicId} AND entity_id = ${entityId} ORDER BY created_at, id`;
