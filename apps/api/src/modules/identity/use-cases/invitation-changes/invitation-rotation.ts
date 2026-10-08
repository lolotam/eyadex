import type { Invitation } from "@eyadex/contracts/invitations";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import { checkLimit, usersUsage, type Clock } from "../../../tenancy/index.ts";
import { invitationExpiry } from "../../domain/system-roles.ts";
import { decideInvitationResend } from "../../domain/user-rules.ts";
import { issueInvitationToken } from "../../persistence/pg-first-admin-provisioner.ts";
import {
  findInvitationForUpdate,
  renewEmail,
  reserveEmail,
  rotateInvitation,
} from "../../persistence/pg-invitation-store.ts";
import {
  activeRole,
  assertActiveBranches,
  lockClinicBranches,
  lockClinicUsers,
  readSeats,
} from "../../persistence/pg-user-store.ts";
import { findInvitationView } from "../../queries/invitation-views.ts";
import { lockClinicRoles } from "../../persistence/pg-role-store.ts";
import { assertActorMay, assertMayGrantRole } from "../role-changes/grant-bound.ts";
import {
  assertMayTouchAdmin,
  usersLimitError,
  type UserActor,
} from "../user-changes/user-changes.ts";

// Resend and copy-link share this one rotation (ADR-0012 §6, §16): the same checks in the same order.

/** The invitation before and after the rotation, and the new raw token (never stored, never logged). */
export interface Rotation {
  readonly before: Invitation;
  readonly invitation: Invitation;
  readonly token: string;
}

/** Throws `limit_reached` when one more seat would pass the clinic's user limit. */
export async function assertSeat(tx: Tx, clinicId: string, now: Date): Promise<void> {
  const seats = await readSeats(tx, clinicId, now);
  const usage = usersUsage(seats.members, seats.invitations, seats.max);
  if (checkLimit(usage).kind === "exceeded") throw usersLimitError(usage.used, usage.max);
}

/** The invitation as the API shows it (`token: null`). */
export async function invitationView(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<Invitation> {
  const view = await findInvitationView(tx, clinicId, id, now);
  if (view === null) throw new ApiError("not_found");
  return view;
}

/**
 * Roles lock → users lock → invitation row → branches lock → clock → pending only → active role and branches →
 * admin-role guard → granting bound → seat when expired → email hold → new token, hash and expiry.
 */
export async function rotateInvitationLink(
  tx: Tx,
  clock: Clock,
  actor: UserActor,
  invitationId: string,
): Promise<Rotation> {
  const { clinicId } = actor;
  await lockClinicRoles(tx, clinicId);
  await lockClinicUsers(tx, clinicId);
  // Resend and copy-link share the route key; rechecked on the actor as it is after the locks.
  await assertActorMay(tx, actor, "create:users:clinic");
  const locked = await findInvitationForUpdate(tx, clinicId, invitationId);
  if (locked === null) throw new ApiError("not_found");
  await lockClinicBranches(tx, clinicId);
  // Read after the last lock: waiting may expire this invitation, which then needs a free seat.
  const now = clock.now();
  const decision = decideInvitationResend(locked.status, locked.expiresAt, now);
  if (decision === "not_pending") {
    throw new ApiError(locked.status === "accepted" ? "invitation_used" : "invitation_cancelled");
  }
  const role = await activeRole(tx, clinicId, locked.roleId);
  await assertActiveBranches(tx, clinicId, locked.allBranches ? [] : locked.branchIds);
  await assertMayTouchAdmin(tx, actor, [role.systemKey]);
  // Resend mails a link and copy-link hands one to the actor: both give the role to someone.
  await assertMayGrantRole(tx, actor, "create:users:clinic", role.id, locked);
  if (decision === "reoccupies_seat") await assertSeat(tx, clinicId, now);
  const before = await invitationView(tx, clinicId, invitationId, now);
  const expiresAt = invitationExpiry(now);
  // The hold first: the 0017 trigger checks it covers the new expiry. An expired hold may have been
  // taken over and released since, so a free email is reserved again for this invitation.
  const held =
    (await renewEmail(tx, locked.email, invitationId, expiresAt)) ||
    (await reserveEmail(tx, locked.email, invitationId, expiresAt));
  if (!held) throw new ApiError("email_taken");
  const { token, hash } = issueInvitationToken();
  await rotateInvitation(tx, clinicId, invitationId, hash, expiresAt);
  const invitation = await invitationView(tx, clinicId, invitationId, now);
  return { before, invitation, token };
}
