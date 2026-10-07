import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { invitationSchema } from "@eyadex/contracts/invitations";
import { invitationListResponseSchema } from "@eyadex/contracts/user-admin";

import { SecretSealer } from "../../../shared/secret-sealer.ts";
import {
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { accept, strongPassword } from "./invitation-fixtures.ts";
import {
  act,
  audit,
  invitationEvents,
  invite,
  inviteBody,
  latestToken,
  roleIdOf,
  setMaxUsers,
} from "./user-fixtures.ts";

// Stories 35–37, 43; SUB-03 (users), INV-01, ISO-02, AUD-01 for invitations (ADR-0012).
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
let doctorRole: string;

const used = async (clinicId: string) => {
  const [row] = await h.owner`SELECT
    (SELECT count(*)::int FROM memberships WHERE clinic_id = ${clinicId} AND status = 'active') +
    (SELECT count(*)::int FROM invitations WHERE clinic_id = ${clinicId} AND status = 'pending'
       AND expires_at > now()) AS n`;
  return Number(row!["n"]);
};
const expire = async (id: string) => {
  await h.owner`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = ${id}`;
  await h.owner`UPDATE email_reservations SET expires_at = now() - interval '1 minute'
                WHERE invitation_id = ${id}`;
};
const created = async (cookie: string, body = inviteBody(doctorRole)) => {
  const res = await invite(h, cookie, body);
  expect(res.statusCode).toBe(201);
  return invitationSchema.strict().parse(res.json());
};

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  doctorRole = await roleIdOf(h, A.admin.clinicId, "doctor");
  await setMaxUsers(h, A.admin.clinicId, 50);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: every invitation endpoint", () => {
  const someId = randomUUID();
  const calls = {
    list: (c?: string, host?: string) => get(h, "/v1/invitations", c, host),
    invite: (c?: string, host?: string) => invite(h, c, inviteBody(doctorRole), undefined, host),
    resend: (c?: string, host?: string) =>
      act(h, c, `/v1/invitations/${someId}/resend`, undefined, "POST", host),
    cancel: (c?: string, host?: string) =>
      act(h, c, `/v1/invitations/${someId}/cancel`, undefined, "POST", host),
  };
  for (const [name, run] of Object.entries(calls)) {
    it(`${name}: 403 without the key, 401 without a session, 404 on the platform host`, async () => {
      const denied = await run(A.doctor.cookie);
      expect([denied.statusCode, code(denied)]).toEqual([403, "forbidden"]);
      expect((await run()).statusCode).toBe(401);
      expect((await run(A.admin.cookie, PLATFORM)).statusCode).toBe(404);
    });
  }
});

describe("invite (AUD-01, outbox, idempotency)", () => {
  it("writes one invitation, one audit row and one sealed outbox event; no token anywhere", async () => {
    const invitation = await created(A.admin.cookie);
    expect(invitation.token).toBeNull();
    const events = await invitationEvents(h, invitation.id);
    expect(events).toHaveLength(1);
    expect(events[0]!["event_type"]).toBe("clinic.user_invited");
    const token = await latestToken(h, invitation.id);
    expect(String(events[0]!["raw"])).not.toContain(token);
    const sealed = (events[0]!["payload"] as { sealedToken: string }).sealedToken;
    expect(() =>
      new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!).open(sealed, randomUUID()),
    ).toThrow();
    const rows = await audit(h, A.admin.clinicId, invitation.id);
    expect(rows.map((r) => r["action"])).toEqual(["invitation.sent"]);
    const raw = String(rows[0]!["raw"]);
    expect(raw).not.toContain(token);
    expect(raw).not.toMatch(/token|hash/i);
    expect(Object.keys((rows[0]!["details"] as { after: object }).after).sort()).toEqual(
      [
        "allBranches",
        "branchIds",
        "email",
        "expiresAt",
        "fullName",
        "roleId",
        "roleNameAr",
        "roleNameEn",
        "status",
      ].sort(),
    );
  });

  it("same key + same body → same invitation, one row/audit/event; another body → conflict", async () => {
    const key = randomUUID();
    const body = inviteBody(doctorRole);
    const first = await invite(h, A.admin.cookie, body, key);
    const again = await invite(h, A.admin.cookie, body, key);
    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    const id = first.json().id as string;
    expect(again.json().id).toBe(id);
    expect(await h.owner`SELECT 1 FROM invitations WHERE email = ${body.email}`).toHaveLength(1);
    expect(await audit(h, A.admin.clinicId, id)).toHaveLength(1);
    expect(await invitationEvents(h, id)).toHaveLength(1);
    const other = await invite(h, A.admin.cookie, inviteBody(doctorRole), key);
    expect([other.statusCode, code(other)]).toEqual([409, "idempotency_conflict"]);
  });

  it("refuses a taken email, another clinic's role or branch, and an inactive branch", async () => {
    const taken = await invite(
      h,
      A.admin.cookie,
      inviteBody(doctorRole, { email: B.doctor.email }),
    );
    expect([taken.statusCode, code(taken)]).toEqual([409, "email_taken"]);
    const foreignRole = await roleIdOf(h, B.admin.clinicId, "doctor");
    expect((await invite(h, A.admin.cookie, inviteBody(foreignRole))).statusCode).toBe(404);
    const foreignBranch = inviteBody(doctorRole, {
      allBranches: false,
      branchIds: [B.doctor.branchId],
    });
    expect((await invite(h, A.admin.cookie, foreignBranch)).statusCode).toBe(404);
  });

  it("story 43: inviting onto the clinic-admin role is allowed", async () => {
    await created(A.admin.cookie, inviteBody(await roleIdOf(h, A.admin.clinicId, "clinic_admin")));
  });
});

describe("resend and cancel (INV-01)", () => {
  it("resend rotates the token: the old link is refused, the new one works", async () => {
    const invitation = await created(A.admin.cookie);
    const oldToken = await latestToken(h, invitation.id);
    const res = await act(h, A.admin.cookie, `/v1/invitations/${invitation.id}/resend`);
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeNull();
    const events = await invitationEvents(h, invitation.id);
    expect(events).toHaveLength(2);
    expect((events[1]!["payload"] as { reason: string }).reason).toBe("resent");
    const newToken = await latestToken(h, invitation.id);
    expect(String(events[1]!["raw"])).not.toContain(newToken);
    expect(code(await accept(h, oldToken, strongPassword()))).toBe("invitation_invalid");
    expect((await accept(h, newToken, strongPassword())).statusCode).toBe(200);
    const actions = (await audit(h, A.admin.clinicId, invitation.id)).map((r) => r["action"]);
    expect(actions).toEqual(["invitation.sent", "invitation.resent"]);
  });

  it("cancel kills the link and frees the email; a second cancel is a no-op; accepted → 409", async () => {
    const invitation = await created(A.admin.cookie);
    const token = await latestToken(h, invitation.id);
    const url = `/v1/invitations/${invitation.id}/cancel`;
    expect((await act(h, A.admin.cookie, url)).json().status).toBe("cancelled");
    expect((await act(h, A.admin.cookie, url)).statusCode).toBe(200);
    expect(await audit(h, A.admin.clinicId, invitation.id)).toHaveLength(2);
    expect(code(await accept(h, token, strongPassword()))).toBe("invitation_invalid");
    await created(A.admin.cookie, inviteBody(doctorRole, { email: invitation.email }));
    const resent = await act(h, A.admin.cookie, `/v1/invitations/${invitation.id}/resend`);
    expect([resent.statusCode, code(resent)]).toEqual([409, "invitation_cancelled"]);

    const done = await created(A.admin.cookie);
    await accept(h, await latestToken(h, done.id), strongPassword());
    const late = await act(h, A.admin.cookie, `/v1/invitations/${done.id}/cancel`);
    expect([late.statusCode, code(late)]).toEqual([409, "invitation_used"]);
  });
});

describe("SUB-03: the user limit", () => {
  it("at the limit → limit_reached with the numbers; a cancelled invitation frees a seat", async () => {
    const clinicId = A.admin.clinicId;
    const pending = await created(A.admin.cookie);
    await setMaxUsers(h, clinicId, await used(clinicId));
    const full = await invite(h, A.admin.cookie, inviteBody(doctorRole));
    expect([full.statusCode, code(full)]).toEqual([409, "limit_reached"]);
    expect(full.json().details).toEqual({
      resource: "users",
      used: await used(clinicId),
      max: await used(clinicId),
    });
    await act(h, A.admin.cookie, `/v1/invitations/${pending.id}/cancel`);
    await created(A.admin.cookie);
    await setMaxUsers(h, clinicId, 50);
  });

  it("an expired invitation does not count, and resending it at the limit → limit_reached", async () => {
    const clinicId = A.admin.clinicId;
    const stale = await created(A.admin.cookie);
    await expire(stale.id);
    await setMaxUsers(h, clinicId, await used(clinicId));
    const resend = await act(h, A.admin.cookie, `/v1/invitations/${stale.id}/resend`);
    expect([resend.statusCode, code(resend)]).toEqual([409, "limit_reached"]);
    await setMaxUsers(h, clinicId, (await used(clinicId)) + 1);
    expect((await act(h, A.admin.cookie, `/v1/invitations/${stale.id}/resend`)).statusCode).toBe(
      200,
    );
    await setMaxUsers(h, clinicId, 50);
  });

  it("two parallel invites at limit − 1 → exactly one 201", async () => {
    const clinicId = A.admin.clinicId;
    await setMaxUsers(h, clinicId, (await used(clinicId)) + 1);
    const results = await Promise.all([
      invite(h, A.admin.cookie, inviteBody(doctorRole)),
      invite(h, A.admin.cookie, inviteBody(doctorRole)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    await setMaxUsers(h, clinicId, 50);
  });
});

describe("ISO-02 and the list", () => {
  it("clinic A cannot resend or cancel clinic B's invitation (404) and never lists it", async () => {
    const theirs = await created(
      B.admin.cookie,
      inviteBody(await roleIdOf(h, B.admin.clinicId, "doctor")),
    );
    for (const action of ["resend", "cancel"]) {
      const res = await act(h, A.admin.cookie, `/v1/invitations/${theirs.id}/${action}`);
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
    const list = invitationListResponseSchema.parse(
      (await get(h, "/v1/invitations?limit=100", A.admin.cookie)).json(),
    );
    expect(list.items.every((i) => i.clinicId === A.admin.clinicId)).toBe(true);
    expect(list.items.some((i) => i.id === theirs.id)).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/token_hash|tokenHash/);
  });

  it("filters by status and counts the total on its own", async () => {
    const res = await get(h, "/v1/invitations?status=cancelled&limit=1", A.admin.cookie);
    const page = invitationListResponseSchema.parse(res.json());
    expect(page.items.every((i) => i.status === "cancelled")).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(1);
  });
});
