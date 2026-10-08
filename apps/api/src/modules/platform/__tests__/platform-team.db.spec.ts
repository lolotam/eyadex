import { randomUUID } from "node:crypto";

import { SecretSealer } from "@eyadex/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clinicWithMembers, settledOrBlocked } from "../../identity/__tests__/access-fixtures.ts";
import {
  APP,
  call,
  closeHarness,
  createUser,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { PLATFORM_ACCOUNT_GATE } from "../../identity/ports/platform-account-gate.ts";
import { CLOCK } from "../../tenancy/index.ts";
import { enrolledCookie, joinPlatformTeam, platformStaff } from "./platform-staff.ts";

// ADR-0020: the platform team over HTTP — invite (Idempotency-Key, sealed link), accept on the platform
// host, the gate on every platform request, deactivation (ADM-02) and reactivation.
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
const strong = () => `Pw-${randomUUID()}`;
const ip = () =>
  `10.9.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

const invite = (body: unknown, key: string | null = randomUUID(), cookie = staff.cookie) =>
  call(h, {
    url: "/v1/platform/team",
    host: PLATFORM,
    cookie,
    body,
    headers: key === null ? {} : { "idempotency-key": key },
  });
const post = (url: string, cookie = staff.cookie) => call(h, { url, host: PLATFORM, cookie });
const pub = (path: "inspect" | "accept", body: unknown, host = PLATFORM) =>
  call(h, { url: `/v1/platform/invitations/${path}`, host, body, ip: ip() });
const me = (cookie: string) =>
  call(h, { method: "GET", url: "/v1/platform/me", host: PLATFORM, cookie });

async function linkFor(accountId: string): Promise<string> {
  const [event] = await h.owner<{ id: string; payload: { sealedToken: string } }[]>`
    SELECT id, payload FROM outbox_events WHERE event_type = 'platform.team_invited'
      AND payload ->> 'accountId' = ${accountId} ORDER BY created_at DESC LIMIT 1`;
  return new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!).open(
    event!.payload.sealedToken,
    event!.id,
  );
}

const person = () => ({ fullName: "Team Member", email: `team-${randomUUID()}@example.test` });

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("invite (story 24)", () => {
  it("writes an invited account, holds the email, and queues one sealed link; no raw token anywhere", async () => {
    const who = person();
    const res = await invite(who);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ...who, status: "invited", joinedAt: null });
    const token = await linkFor(res.json().id);
    const [hold] = await h.owner`SELECT kind FROM email_reservations WHERE email = ${who.email}`;
    expect(hold!["kind"]).toBe("platform");
    for (const [table, column] of [
      ["outbox_events", "payload::text"],
      ["platform_audit_log", "details::text"],
      ["platform_accounts", "coalesce(token_hash, '')"],
    ] as const) {
      const rows = await h.owner.unsafe(`SELECT 1 FROM ${table} WHERE ${column} LIKE $1`, [
        `%${token}%`,
      ]);
      expect(rows, table).toHaveLength(0);
    }
    expect(h.logs.join("")).not.toContain(token);
  });

  it("replays the same key + body, conflicts on a changed body, and needs a key", async () => {
    const who = person();
    const key = randomUUID();
    const first = await invite(who, key);
    const again = await invite(who, key);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    const [events] = await h.owner`SELECT count(*)::int AS n FROM outbox_events
      WHERE payload ->> 'accountId' = ${first.json().id}`;
    expect(events!["n"]).toBe(1);
    expect((await invite({ ...who, fullName: "Other Name" }, key)).json().code).toBe(
      "idempotency_conflict",
    );
    expect((await invite(person(), null)).statusCode).toBe(400);
  });

  it("re-inviting an invited email sends a new link and kills the old one; a member's email is taken", async () => {
    const who = person();
    const first = await invite(who);
    const oldToken = await linkFor(first.json().id);
    const second = await invite(who);
    expect(second.json().id).toBe(first.json().id);
    const newToken = await linkFor(first.json().id);
    expect(newToken).not.toBe(oldToken);
    expect((await pub("inspect", { token: oldToken })).statusCode).toBe(404);
    expect((await pub("inspect", { token: newToken })).json()).toMatchObject(who);
    const clinic = await clinicWithMembers(h);
    const taken = await invite({ fullName: "Clinic Admin", email: clinic.admin.email });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe("email_taken");
  });

  it("NEGATIVE: the clinic host answers 404 and a session without TOTP 403", async () => {
    const onClinic = await call(h, {
      url: "/v1/platform/team",
      host: APP,
      cookie: staff.cookie,
      body: person(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(onClinic.statusCode).toBe(404);
    expect((await invite(person(), randomUUID(), staff.noTotpCookie)).statusCode).toBe(403);
  });
});

describe("accept, then sign in with TOTP", () => {
  it("creates a platform account, links the row, and the new member passes the gate", async () => {
    const who = person();
    const account = (await invite(who)).json();
    const token = await linkFor(account.id);
    expect((await pub("accept", { token, password: strong() }, APP)).statusCode).toBe(404);
    const pw = strong();
    const accepted = await pub("accept", { token, password: pw });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ email: who.email });
    const [row] = await h.owner`SELECT status, user_id, token_hash FROM platform_accounts
                                WHERE id = ${account.id}`;
    expect(row).toMatchObject({ status: "active", token_hash: null });
    const [user] = await h.owner`SELECT area FROM auth_users WHERE id = ${row!["user_id"]}`;
    expect(user!["area"]).toBe("platform");
    expect((await pub("accept", { token, password: strong() })).json().code).toBe(
      "invitation_invalid",
    );
    const cookie = await enrolledCookie(h, who.email, pw);
    const mine = await me(cookie);
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toEqual({ id: account.id, fullName: who.fullName, email: who.email });
    const [audit] = await h.owner`SELECT actor_user_id FROM platform_audit_log
      WHERE action = 'platform_account.joined' AND details ->> 'accountId' = ${account.id}`;
    expect(audit!["actor_user_id"]).toBe(row!["user_id"]);
  });

  it("NEGATIVE: an expired link is refused (decided on the API clock)", async () => {
    const account = (await invite(person())).json();
    const token = await linkFor(account.id);
    const clock = h.app.get<{ now: () => Date }>(CLOCK);
    const real = clock.now;
    clock.now = () => new Date(Date.now() + 8 * 24 * 3600 * 1000);
    try {
      expect((await pub("inspect", { token })).statusCode).toBe(404);
      expect((await pub("accept", { token, password: strong() })).statusCode).toBe(404);
    } finally {
      clock.now = real;
    }
  });
});

describe("the gate and deactivation (ADM-02)", () => {
  it("NEGATIVE: an account with no team row, or a deactivated one, is refused with account_disabled", async () => {
    const orphan = await createUser(h, h.areaAuth.of("platform"), "orphan");
    const orphanCookie = await enrolledCookie(h, orphan.email);
    const refused = await me(orphanCookie);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().code).toBe("account_disabled");
    const off = await createUser(h, h.areaAuth.of("platform"), "off");
    await joinPlatformTeam(h, off, "deactivated");
    expect((await me(await enrolledCookie(h, off.email))).json().code).toBe("account_disabled");
  });

  it("deactivating ends the member's sessions at once; reactivating restores access", async () => {
    const member = await createUser(h, h.areaAuth.of("platform"), "member");
    await joinPlatformTeam(h, member);
    const cookie = await enrolledCookie(h, member.email);
    expect((await me(cookie)).statusCode).toBe(200);
    const off = await post(`/v1/platform/team/${member.userId}/deactivate`);
    expect(off.statusCode).toBe(200);
    expect(off.json().status).toBe("deactivated");
    expect((await me(cookie)).statusCode).toBe(401);
    const [sessions] = await h.owner`SELECT count(*)::int AS n FROM auth_sessions
                                     WHERE user_id = ${member.userId}`;
    expect(sessions!["n"]).toBe(0);
    const on = await post(`/v1/platform/team/${member.userId}/reactivate`);
    expect(on.json().status).toBe("active");
    // TOTP is already enrolled, so the gate itself is asked: the account passes it again.
    const gate = h.app.get<{ isActive(userId: string): Promise<boolean> }>(PLATFORM_ACCOUNT_GATE);
    expect(await gate.isActive(member.userId)).toBe(true);
  });

  it("reactivating an account that never joined returns it to invited, with its link dead", async () => {
    const account = (await invite(person())).json();
    const token = await linkFor(account.id);
    expect((await post(`/v1/platform/team/${account.id}/deactivate`)).json().status).toBe(
      "deactivated",
    );
    expect((await pub("inspect", { token })).statusCode).toBe(404);
    expect((await post(`/v1/platform/team/${account.id}/reactivate`)).json().status).toBe(
      "invited",
    );
    expect((await pub("inspect", { token })).statusCode).toBe(404);
  });

  it("NEGATIVE: a deactivation that lands while a request waits for the team lock wins (no self-reactivation)", async () => {
    const member = await createUser(h, h.areaAuth.of("platform"), "racer");
    await joinPlatformTeam(h, member);
    const cookie = await enrolledCookie(h, member.email);
    // Another member's deactivation of this account, holding the team lock until it commits.
    const other = await h.owner.reserve();
    try {
      await other`BEGIN`;
      await other`SELECT pg_advisory_xact_lock(hashtextextended('platform_team', 0))`;
      await other`UPDATE platform_accounts SET status = 'deactivated' WHERE id = ${member.userId}`;
      // The request passed the gate (the change is not committed yet) and now waits for the lock.
      const pending = post(`/v1/platform/team/${member.userId}/reactivate`, cookie);
      await settledOrBlocked(h, pending);
      await other`COMMIT`;
      const res = await pending;
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("account_disabled");
    } finally {
      other.release();
    }
    const [row] = await h.owner`SELECT status FROM platform_accounts WHERE id = ${member.userId}`;
    expect(row!["status"]).toBe("deactivated");
  });

  it("NEGATIVE: the last active platform account cannot be deactivated", async () => {
    const others = await h.owner<
      { id: string }[]
    >`UPDATE platform_accounts SET status = 'deactivated'
      WHERE status = 'active' AND user_id <> ${staff.actorId} RETURNING id`;
    try {
      const res = await post(`/v1/platform/team/${staff.actorId}/deactivate`);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("last_active_platform_account");
      const [row] = await h.owner`SELECT status FROM platform_accounts WHERE id = ${staff.actorId}`;
      expect(row!["status"]).toBe("active");
    } finally {
      const ids = others.map((o) => o.id);
      if (ids.length > 0) {
        await h.owner`UPDATE platform_accounts SET status = 'active' WHERE id IN ${h.owner(ids)}`;
      }
    }
  });

  it("lists the team oldest first with a cursor, and names the account in the platform audit", async () => {
    const page = await call(h, {
      method: "GET",
      url: "/v1/platform/team?limit=2",
      host: PLATFORM,
      cookie: staff.cookie,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(2);
    const next = await call(h, {
      method: "GET",
      url: `/v1/platform/team?limit=2&cursor=${page.json().nextCursor}`,
      host: PLATFORM,
      cookie: staff.cookie,
    });
    const seen = [...page.json().items, ...next.json().items].map((a: { id: string }) => a.id);
    expect(new Set(seen).size).toBe(seen.length);
    const audit = await call(h, {
      method: "GET",
      url: "/v1/platform/audit?entity=platform_account&limit=5",
      host: PLATFORM,
      cookie: staff.cookie,
    });
    expect(audit.statusCode).toBe(200);
    const item = audit.json().items[0];
    expect(item.entityId).not.toBeNull();
    expect(item.after).toHaveProperty("status");
    expect(JSON.stringify(audit.json())).not.toContain("tokenHash");
  });
});
