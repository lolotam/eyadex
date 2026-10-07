import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { invitationLinkSchema } from "@eyadex/contracts/invitations";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { accept, inspect, strongPassword } from "./invitation-fixtures.ts";
import {
  act,
  audit,
  customRole,
  invitationEvents,
  invite,
  inviteBody,
  latestToken,
  memberOn,
  roleIdOf,
  setMaxUsers,
} from "./user-fixtures.ts";

// Slice 7a — copy invitation link (ADR-0012 §6): resend's checks, a new token, no email, one audit row.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
let doctorRole: string;

const sent = async (cookie: string, body = inviteBody(doctorRole)) => {
  const res = await invite(h, cookie, body);
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
};
const copy = (cookie: string, id: string) => act(h, cookie, `/v1/invitations/${id}/link`);

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

describe("POST /v1/invitations/:id/link", () => {
  it("returns a working link, kills the emailed one, mails nothing, audits without the token", async () => {
    const id = await sent(A.admin.cookie);
    const emailed = await latestToken(h, id);
    const eventsBefore = (await invitationEvents(h, id)).length;
    const res = await copy(A.admin.cookie, id);
    expect(res.statusCode).toBe(200);
    const link = invitationLinkSchema.strict().parse(res.json());
    expect((await invitationEvents(h, id)).length).toBe(eventsBefore);
    const rows = (await audit(h, A.admin.clinicId, id)).filter(
      (r) => r["action"] === "invitation.link_copied",
    );
    expect(rows).toHaveLength(1);
    const [stored] = await h.owner`SELECT token_hash FROM invitations WHERE id = ${id}`;
    const raw = String(rows[0]!["raw"]);
    expect(raw).not.toContain(link.token);
    expect(raw).not.toContain(String(stored!["token_hash"]));
    expect(raw).not.toContain("token_hash");
    expect(code(await accept(h, emailed, strongPassword()))).toBe("invitation_invalid");
    expect((await inspect(h, link.token)).statusCode).toBe(200);
    expect((await accept(h, link.token, strongPassword())).statusCode).toBe(200);
    const lists = [
      await get(h, "/v1/invitations?status=accepted", A.admin.cookie),
      await get(h, "/v1/invitations", A.admin.cookie),
      await get(h, "/v1/users", A.admin.cookie),
    ];
    for (const list of lists) expect(list.body).not.toContain(link.token);
    expect(h.logs.join("\n")).not.toContain(link.token);
  });

  it("needs create:users:clinic, and an active admin for the clinic-admin role", async () => {
    const viewer = await memberOn(
      h,
      A.admin,
      await customRole(h, A.admin.clinicId, ["view:users:clinic"]),
    );
    const id = await sent(A.admin.cookie);
    expect((await copy(viewer.cookie, id)).statusCode).toBe(403);
    const manager = await memberOn(
      h,
      A.admin,
      await customRole(h, A.admin.clinicId, ["view:users:clinic", "create:users:clinic"]),
    );
    const adminRole = await roleIdOf(h, A.admin.clinicId, "clinic_admin");
    const onAdmin = await sent(A.admin.cookie, inviteBody(adminRole));
    const refused = await copy(manager.cookie, onAdmin);
    expect([refused.statusCode, code(refused)]).toEqual([403, "forbidden"]);
    expect((await copy(manager.cookie, id)).statusCode).toBe(200);
    expect((await copy(A.admin.cookie, onAdmin)).statusCode).toBe(200);
  });

  it("refuses accepted, cancelled, another clinic's and malformed ids", async () => {
    const used = await sent(A.admin.cookie);
    await accept(h, await latestToken(h, used), strongPassword());
    expect(code(await copy(A.admin.cookie, used))).toBe("invitation_used");
    const gone = await sent(A.admin.cookie);
    await act(h, A.admin.cookie, `/v1/invitations/${gone}/cancel`);
    expect(code(await copy(A.admin.cookie, gone))).toBe("invitation_cancelled");
    const theirs = await sent(
      B.admin.cookie,
      inviteBody(await roleIdOf(h, B.admin.clinicId, "doctor")),
    );
    expect((await copy(A.admin.cookie, theirs)).statusCode).toBe(404);
    expect((await copy(A.admin.cookie, "not-a-uuid")).statusCode).toBe(404);
    expect((await copy(A.admin.cookie, randomUUID())).statusCode).toBe(404);
  });

  it("an expired invitation in a full clinic → limit_reached", async () => {
    const C = await clinicWithMembers(h);
    const role = await roleIdOf(h, C.admin.clinicId, "doctor");
    await setMaxUsers(h, C.admin.clinicId, 50);
    const id = await sent(C.admin.cookie, inviteBody(role));
    await h.owner`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = ${id}`;
    await h.owner`UPDATE email_reservations SET expires_at = now() - interval '1 minute'
                  WHERE invitation_id = ${id}`;
    const [row] = await h.owner`SELECT
      (SELECT count(*)::int FROM memberships WHERE clinic_id = ${C.admin.clinicId} AND status = 'active')
      + (SELECT count(*)::int FROM invitations WHERE clinic_id = ${C.admin.clinicId}
           AND status = 'pending' AND expires_at > now()) AS n`;
    await setMaxUsers(h, C.admin.clinicId, Number(row!["n"]));
    const res = await copy(C.admin.cookie, id);
    expect([res.statusCode, code(res)]).toEqual([409, "limit_reached"]);
  });
});
