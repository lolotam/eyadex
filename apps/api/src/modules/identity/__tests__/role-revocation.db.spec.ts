import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { createRole, names } from "./role-fixtures.ts";
import { act, customRole, memberOn, setMaxUsers } from "./user-fixtures.ts";

// Codex round 3 (ADR-0017 §6): the guard decides a route's permission before the request waits on
// the `roles:` lock, so every write behind that lock rechecks it on the actor as the database holds
// it after the lock. A request queued behind a revocation of its own route key writes nothing.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
});

afterAll(async () => {
  await closeHarness(h);
});

/**
 * Holds the clinic's `roles:` lock on a second connection while it removes `key` from `roleId`, then
 * runs `request`, waits until it queues on an advisory lock (pg_locks), and commits the revocation.
 */
async function queuedBehindRevocation<T>(
  roleId: string,
  key: string,
  request: () => Promise<T>,
): Promise<{ blocked: boolean; answer: T }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const holding = new Promise<void>((resolve) => (locked = resolve));
  const revocation = h.owner.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${A.admin.clinicId}`}, 0))`;
    await sql`DELETE FROM role_permissions rp USING permissions p
              WHERE rp.role_id = ${roleId} AND p.id = rp.permission_id AND p.key = ${key}`;
    locked();
    await gate;
  });
  await holding;
  const pending = request();
  let blocked = false;
  for (let i = 0; i < 100 && !blocked; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                WHERE locktype = 'advisory' AND NOT granted`;
    blocked = row!["n"] !== 0;
    if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  release();
  await revocation;
  return { blocked, answer: await pending };
}

describe("a revoked route key is refused after the lock, with nothing written", () => {
  it("NEGATIVE: a role create queued behind the revocation of create:roles:clinic", async () => {
    const keys = ["view:roles:clinic", "create:roles:clinic"];
    const actorRole = await customRole(h, A.admin.clinicId, keys);
    const actor = await memberOn(h, A.admin, actorRole);
    expect((await get(h, "/v1/roles", actor.cookie)).statusCode).toBe(200); // warm the cache
    const key = randomUUID();
    const body = { ...names("Queued"), permissionKeys: [] }; // still covered by any actor
    const { blocked, answer } = await queuedBehindRevocation(actorRole, "create:roles:clinic", () =>
      createRole(h, actor.cookie, body, key),
    );
    expect(blocked).toBe(true);
    expect([answer.statusCode, code(answer)]).toEqual([403, "forbidden"]);
    expect(await h.owner`SELECT id FROM roles WHERE name_en = ${body.nameEn}`).toHaveLength(0);
    expect(
      await h.owner`SELECT id FROM audit_log WHERE clinic_id = ${A.admin.clinicId}
                    AND actor_user_id = ${actor.userId} AND action = 'role.created'`,
    ).toHaveLength(0);
    expect(
      await h.owner`SELECT id FROM clinic_idempotency_keys
                    WHERE clinic_id = ${A.admin.clinicId} AND key = ${key}`,
    ).toHaveLength(0);
  });

  it("NEGATIVE: a change role queued behind the revocation of update:users:clinic", async () => {
    const keys = ["view:users:clinic", "update:users:clinic"];
    const actorRole = await customRole(h, A.admin.clinicId, keys);
    const actor = await memberOn(h, A.admin, actorRole);
    const from = await customRole(h, A.admin.clinicId, []);
    const to = await customRole(h, A.admin.clinicId, []);
    const target = await memberOn(h, A.admin, from);
    expect((await get(h, "/v1/users", actor.cookie)).statusCode).toBe(200); // warm the cache
    const { blocked, answer } = await queuedBehindRevocation(actorRole, "update:users:clinic", () =>
      act(h, actor.cookie, `/v1/users/${target.memberId}/role`, { roleId: to }, "PATCH"),
    );
    expect(blocked).toBe(true);
    expect([answer.statusCode, code(answer)]).toEqual([403, "forbidden"]);
    const [row] = await h.owner`SELECT role_id FROM memberships WHERE id = ${target.memberId}`;
    expect(row!["role_id"]).toBe(from);
    expect(
      await h.owner`SELECT id FROM audit_log WHERE entity_id = ${target.memberId}
                    AND action = 'user.role_changed'`,
    ).toHaveLength(0);
  });
});
