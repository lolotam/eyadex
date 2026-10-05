import { randomBytes } from "node:crypto";

import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATABASE } from "../../../shared/database.provider.ts";
import { CLOCK } from "../../tenancy/index.ts";
import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { AcceptInvitation } from "../use-cases/accept-invitation/accept-invitation.ts";
import {
  accept,
  branchInvite,
  clinicWithInvite,
  inspect,
  strongPassword,
} from "./invitation-fixtures.ts";

// INV-01 and slice 3b over HTTP, real PostgreSQL + Redis (ADR-0008).
let h: Harness;

beforeAll(async () => {
  h = await openHarness({}, true);
});

afterAll(async () => {
  await closeHarness(h);
});

const signIn = (host: string, email: string, password: string) =>
  call(h, { url: "/auth/sign-in/email", host, body: { email, password } });
const accountsFor = async (email: string) =>
  (await h.owner`SELECT id FROM auth_users WHERE email = ${email}`).length;
const membershipsFor = async (email: string) =>
  (await h.owner`SELECT id FROM memberships WHERE email = ${email}`).length;
const expectInvalid = (res: { statusCode: number; json: () => { code: string } }) => {
  expect(res.statusCode).toBe(404);
  expect(res.json().code).toBe("invitation_invalid");
};

describe("POST /v1/invitations/inspect", () => {
  it("shows the clinic and the invitee for a live link", async () => {
    const invite = await clinicWithInvite(h);
    const res = await inspect(h, invite.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ clinicNameEn: "Acceptance Clinic", email: invite.email });
  });

  it("NEGATIVE: unknown token and platform host", async () => {
    expectInvalid(await inspect(h, randomBytes(32).toString("base64url")));
    const invite = await clinicWithInvite(h);
    expect((await inspect(h, invite.token, PLATFORM)).statusCode).toBe(404);
  });
});

describe("POST /v1/invitations/accept", () => {
  it("creates a clinic account, membership, accepted invitation, converted hold and audit", async () => {
    const invite = await clinicWithInvite(h);
    const password = strongPassword();
    const res = await accept(h, invite.token, password);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ clinicId: invite.clinicId, email: invite.email });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await signIn(APP, invite.email, password)).statusCode).toBe(200);
    expect((await signIn(PLATFORM, invite.email, password)).statusCode).toBe(401);
    const [m] = await h.owner`
      SELECT m.*, r.system_key FROM memberships m
      JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id WHERE m.email = ${invite.email}`;
    expect(m).toMatchObject({ system_key: "clinic_admin", all_branches: true, status: "active" });
    expect(m!["preferred_language"]).toBe("en");
    const [inv] = await h.owner`SELECT status, responded_at FROM invitations WHERE id = ${invite.invitationId}`;
    expect(inv!["status"]).toBe("accepted");
    expect(inv!["responded_at"]).not.toBeNull();
    const [hold] = await h.owner`SELECT kind FROM email_reservations WHERE email = ${invite.email}`;
    expect(hold!["kind"]).toBe("membership");
    const audit = await h.owner`
      SELECT details::text AS d FROM audit_log
      WHERE clinic_id = ${invite.clinicId} AND action = 'invitation.accepted'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!["d"]).not.toMatch(/token|hash|password/i);
  });

  it("copies the invitation's branches when it is not all-branches", async () => {
    const first = await clinicWithInvite(h);
    const invite = await branchInvite(h, first.clinicId);
    expect((await accept(h, invite.token, strongPassword())).statusCode).toBe(200);
    const rows = await h.owner`
      SELECT mb.branch_id, m.all_branches, m.role_id FROM memberships m
      JOIN membership_branches mb ON mb.clinic_id = m.clinic_id AND mb.membership_id = m.id
      WHERE m.email = ${invite.email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ branch_id: invite.branchId, all_branches: false, role_id: invite.roleId });
  });

  it("NEGATIVE (INV-01): used, expired, cancelled and unknown links get one answer", async () => {
    const used = await clinicWithInvite(h);
    await accept(h, used.token, strongPassword());
    expectInvalid(await accept(h, used.token, strongPassword()));

    const expired = await clinicWithInvite(h);
    await h.owner`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = ${expired.invitationId}`;
    expectInvalid(await accept(h, expired.token, strongPassword()));
    expectInvalid(await inspect(h, expired.token));

    const cancelled = await clinicWithInvite(h);
    await h.owner`UPDATE invitations SET status = 'cancelled' WHERE id = ${cancelled.invitationId}`;
    expectInvalid(await accept(h, cancelled.token, strongPassword()));

    expectInvalid(await accept(h, randomBytes(32).toString("base64url"), strongPassword()));
    expect(await accountsFor(expired.email)).toBe(0);
    expect(await accountsFor(cancelled.email)).toBe(0);
  });

  it("NEGATIVE: two parallel accepts → one success, one account, one membership", async () => {
    const invite = await clinicWithInvite(h);
    const results = await Promise.all([
      accept(h, invite.token, strongPassword()),
      accept(h, invite.token, strongPassword()),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(await accountsFor(invite.email)).toBe(1);
    expect(await membershipsFor(invite.email)).toBe(1);
  });

  it("a failure after the account was created is recovered by retrying the same link", async () => {
    const invite = await clinicWithInvite(h);
    const clinicAuth = h.areaAuth.of("clinic");
    const failing = new AcceptInvitation({
      db: h.app.get<Database>(DATABASE),
      clock: h.app.get(CLOCK),
      ids: systemUuidV7(),
      accounts: {
        findAccountByEmail: (email) => clinicAuth.findAccountByEmail(email),
        setAccountPassword: (id, pw) => clinicAuth.setAccountPassword(id, pw),
        createUserAccount: async (account) => {
          await clinicAuth.createUserAccount(account);
          throw new Error("forced failure after the account");
        },
      },
    });
    await expect(failing.accept({ token: invite.token, password: strongPassword() })).rejects.toThrow(
      "forced failure",
    );
    expect(await accountsFor(invite.email)).toBe(1);
    expect(await membershipsFor(invite.email)).toBe(0);
    const password = strongPassword();
    expect((await accept(h, invite.token, password)).statusCode).toBe(200);
    expect(await accountsFor(invite.email)).toBe(1);
    expect(await membershipsFor(invite.email)).toBe(1);
    expect((await signIn(APP, invite.email, password)).statusCode).toBe(200);
  });

  it("NEGATIVE: a platform account with the invited email is never reused", async () => {
    const invite = await clinicWithInvite(h);
    await h.areaAuth.of("platform").createUserAccount({
      email: invite.email,
      name: "Platform person",
      password: strongPassword(),
    });
    const res = await accept(h, invite.token, strongPassword());
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("account_other_area");
    expect(await membershipsFor(invite.email)).toBe(0);
  });

  it("NEGATIVE: the raw token and the password are in no table, audit, outbox, log or response", async () => {
    const invite = await clinicWithInvite(h);
    const password = strongPassword();
    const res = await accept(h, invite.token, password);
    const [dump] = await h.owner`
      SELECT concat_ws('|',
        (SELECT json_agg(t)::text FROM invitations t WHERE clinic_id = ${invite.clinicId}),
        (SELECT json_agg(t)::text FROM memberships t WHERE clinic_id = ${invite.clinicId}),
        (SELECT json_agg(t)::text FROM audit_log t WHERE clinic_id = ${invite.clinicId}),
        (SELECT json_agg(t)::text FROM outbox_events t WHERE clinic_id = ${invite.clinicId}),
        (SELECT json_agg(t)::text FROM auth_users t WHERE email = ${invite.email}),
        (SELECT json_agg(t)::text FROM auth_accounts t)) AS all`;
    const everything = `${String(dump!["all"])}${h.logs.join("\n")}${res.body}`;
    expect(everything).not.toContain(invite.token);
    expect(everything).not.toContain(password);
  });

  it("NEGATIVE: platform host → 404 and nothing written", async () => {
    const invite = await clinicWithInvite(h);
    expect((await accept(h, invite.token, strongPassword(), PLATFORM)).statusCode).toBe(404);
    expect(await accountsFor(invite.email)).toBe(0);
  });

  it("NEGATIVE: the 11th accept for one token is rate limited", async () => {
    const token = randomBytes(32).toString("base64url");
    for (let i = 0; i < 10; i += 1) expectInvalid(await accept(h, token, strongPassword()));
    const res = await accept(h, token, strongPassword());
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("NEGATIVE: the 31st request from one IP is rate limited across tokens", async () => {
    const ip = "10.250.250.250";
    for (let i = 0; i < 30; i += 1) {
      expectInvalid(await inspect(h, randomBytes(32).toString("base64url"), APP, ip));
    }
    expect((await inspect(h, randomBytes(32).toString("base64url"), APP, ip)).statusCode).toBe(429);
  });
});
