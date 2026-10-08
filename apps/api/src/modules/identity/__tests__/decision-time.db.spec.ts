import { randomUUID } from "node:crypto";

import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATABASE } from "../../../shared/database.provider.ts";
import { SecretSealer } from "@eyadex/secrets";
import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { INVITATION_LIFETIME_MS, SYSTEM_ROLES } from "../domain/system-roles.ts";
import { AcceptInvitation } from "../use-cases/accept-invitation/accept-invitation.ts";
import { InvitationChanges } from "../use-cases/invitation-changes/invitation-changes.ts";
import { clinicWithMembers, settledOrBlocked } from "./access-fixtures.ts";
import { branchInvite, clinicWithInvite, strongPassword } from "./invitation-fixtures.ts";
import { invite, inviteBody, roleIdOf, setMaxUsers } from "./user-fixtures.ts";

// ADR-0012 §16: expiry, seats and clinic access are decided with a clock read AFTER the last lock.
// Each test holds a lock in an owner transaction, lets the request block on it, moves a fake clock
// past an invitation's expiry and commits: the request must decide with the later time.

let h: Harness;

beforeAll(async () => {
  h = await openHarness({}, true);
});

afterAll(async () => {
  await closeHarness(h);
});

const MINUTE = 60_000;
// The Clinic Admin's keys, as the guard would hand them to the use case.
const ADMIN_KEYS = SYSTEM_ROLES.find((r) => r.key === "clinic_admin")!.permissions;
const lockKey = (scope: "users" | "branches", clinicId: string) => `${scope}:${clinicId}`;

/** A clock the test moves; every use case built here reads it. */
const fakeClock = (start: Date) => {
  let time = start;
  return { now: () => new Date(time), set: (next: Date) => (time = next) };
};

/** Runs `request` while `key` is held, moves the clock while it waits, then releases the lock. */
async function whileLocked<T>(key: string, request: () => Promise<T>, meanwhile: () => unknown) {
  let pending: Promise<T> | undefined;
  await h.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    pending = request();
    await settledOrBlocked(h, pending);
    await meanwhile();
  });
  return pending!;
}

/** A clinic whose seats are exactly full while its one pending invitation is live; it expires in 1h. */
async function fullClinicWithExpiringInvitation() {
  const D = await clinicWithMembers(h);
  const doctor = await roleIdOf(h, D.admin.clinicId, "doctor");
  const res = await invite(h, D.admin.cookie, inviteBody(doctor));
  const invitationId = (res.json() as { id: string }).id;
  const expiry = new Date(Date.now() + 60 * MINUTE);
  await h.owner`UPDATE invitations SET expires_at = ${expiry} WHERE id = ${invitationId}`;
  const [row] = await h.owner`SELECT
    (SELECT count(*)::int FROM memberships WHERE clinic_id = ${D.admin.clinicId} AND status = 'active')
    + (SELECT count(*)::int FROM invitations WHERE clinic_id = ${D.admin.clinicId}
         AND status = 'pending' AND expires_at > now()) AS n`;
  await setMaxUsers(h, D.admin.clinicId, Number(row!["n"]));
  return { D, doctor, invitationId, expiry };
}

const invitationChanges = (clock: { now: () => Date }) =>
  new InvitationChanges({
    db: h.app.get<Database>(DATABASE),
    clock,
    ids: systemUuidV7(),
    sealer: new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!),
  });

describe("decision time after the last lock (ADR-0012 §16)", () => {
  it("resend: a link that expired while waiting needs a free seat", async () => {
    const { D, invitationId, expiry } = await fullClinicWithExpiringInvitation();
    const clock = fakeClock(new Date(expiry.getTime() - MINUTE));
    const actor = { clinicId: D.admin.clinicId, userId: D.admin.userId, permissions: ADMIN_KEYS };
    // Another seat write holds the users lock while the link expires, then takes the freed seat.
    const resending = whileLocked(
      lockKey("users", D.admin.clinicId),
      () => invitationChanges(clock).resend(actor, invitationId),
      async () => {
        await branchInvite(h, D.admin.clinicId);
        clock.set(new Date(expiry.getTime() + MINUTE));
      },
    );
    await expect(resending).rejects.toMatchObject({ code: "limit_reached" });
  });

  it("invite: an invitation that expired while waiting frees its seat; the link gets 7 full days", async () => {
    const { D, doctor, expiry } = await fullClinicWithExpiringInvitation();
    const clock = fakeClock(new Date(expiry.getTime() - MINUTE));
    const decidedAt = new Date(expiry.getTime() + MINUTE);
    const actor = { clinicId: D.admin.clinicId, userId: D.admin.userId, permissions: ADMIN_KEYS };
    const sent = await whileLocked(
      lockKey("users", D.admin.clinicId),
      () => invitationChanges(clock).invite(actor, inviteBody(doctor), randomUUID()),
      () => clock.set(decidedAt),
    );
    expect(sent.invitation.expiresAt).toBe(
      new Date(decidedAt.getTime() + INVITATION_LIFETIME_MS).toISOString(),
    );
  });

  it("resend: waiting on the branches lock, the new link gets 7 days from decision time", async () => {
    const { D, invitationId, expiry } = await fullClinicWithExpiringInvitation();
    const clock = fakeClock(new Date(expiry.getTime() - 30 * MINUTE));
    const decidedAt = new Date(expiry.getTime() - 10 * MINUTE);
    const actor = { clinicId: D.admin.clinicId, userId: D.admin.userId, permissions: ADMIN_KEYS };
    const resent = await whileLocked(
      lockKey("branches", D.admin.clinicId),
      () => invitationChanges(clock).resend(actor, invitationId),
      () => clock.set(decidedAt),
    );
    expect(resent.invitation.expiresAt).toBe(
      new Date(decidedAt.getTime() + INVITATION_LIFETIME_MS).toISOString(),
    );
  });

  it("accept: a link that expired while waiting on the branches lock is refused", async () => {
    const { clinicId } = await clinicWithInvite(h);
    const link = await branchInvite(h, clinicId);
    const expiry = new Date(Date.now() + 60 * MINUTE);
    await h.owner`UPDATE invitations SET expires_at = ${expiry} WHERE id = ${link.invitationId}`;
    const clock = fakeClock(new Date(expiry.getTime() - MINUTE));
    const accepting = new AcceptInvitation({
      db: h.app.get<Database>(DATABASE),
      accounts: h.areaAuth.of("clinic"),
      clock,
      ids: systemUuidV7(),
    });
    const accepted = whileLocked(
      lockKey("branches", clinicId),
      () => accepting.accept({ token: link.token, password: strongPassword() }),
      () => clock.set(new Date(expiry.getTime() + MINUTE)),
    );
    await expect(accepted).rejects.toMatchObject({ code: "invitation_invalid" });
    const accounts = await h.owner`SELECT id FROM auth_users WHERE email = ${link.email}`;
    const members = await h.owner`SELECT id FROM memberships WHERE email = ${link.email}`;
    expect([accounts.length, members.length]).toEqual([0, 0]);
  });
});
