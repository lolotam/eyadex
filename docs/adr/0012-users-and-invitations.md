# ADR-0012: Users and invitations

- Status: accepted (Phase B slice 7, 2026-10-07)
- Related: ADR-0006 (outbox + sealed links), ADR-0008 (acceptance), ADR-0009 (guard, cache,
  `MemberSessionRevoker`), ADR-0010 (limits), ADR-0011 (branches)

## Context

Stories 35–44 need clinic admins to invite, resend, cancel, list, change role and branches,
deactivate and reactivate members, while keeping the user limit (PRD §4.9), the last active admin
(ADM-01) and the invitation link secret (CLAUDE.md §8). Email delivery is the next slice: this one
only writes outbox events.

## Decision

1. **Endpoints** (clinic host, one access declaration each): `GET/POST /v1/invitations`,
   `POST /v1/invitations/:id/{resend,cancel}`, `GET /v1/users`,
   `PATCH /v1/users/:id/{role,branches}`, `POST /v1/users/:id/{deactivate,reactivate}`. `:id` of a
   user is the membership id. A malformed or another clinic's id answers 404 (ISO-02).
2. **The users lock.** Every write that takes a seat or can remove an admin starts with
   `pg_advisory_xact_lock(hashtextextended('users:' || clinic_id, 0))`, then reads and decides in
   the same transaction. It is a separate key from `branches:` (ADR-0011) so a branch edit and an
   invitation never wait on each other. A path that needs both (changing a member's branches)
   takes `users:` first, then `branches:`; branch writes never take `users:`, so there is no
   deadlock.
3. **What counts as a seat**: active memberships + pending invitations with `expires_at > now`
   (`usersUsage`). Deactivated members, cancelled, accepted and expired invitations do not count.
   Invite and reactivate check `used + 1 <= max`; resending an EXPIRED invitation re-occupies a
   seat, so it runs the same check; resending a live one does not change usage. Over the limit →
   `limit_reached` (409) `{ resource: "users", used, max }`.
4. **Idempotency.** `POST /v1/invitations` requires `Idempotency-Key`, claimed in
   `clinic_idempotency_keys` (scope `invitation:create:<userId>`) in the same transaction. The key
   stores the invitation id; a replay returns that invitation as it is NOW (a later resend or cancel
   shows), with no new row, audit row or outbox event.
5. **Email hold.** Invite calls `reserve_invitation_email` (a platform account, a member of any
   clinic — active or deactivated — or a live invitation → `email_taken`); resend calls
   `renew_invitation_email` before moving `expires_at` (the 0017 trigger checks the hold); cancel
   calls `release_invitation_email`. If an expired invitation's hold was taken by someone else,
   resend answers `email_taken`.
6. **Token rotation and no token in responses.** Only the SHA-256 hash is stored. Resend issues a
   new token and hash, so the old link stops working at once. Responses always carry
   `token: null`; the raw token exists only sealed inside the outbox event.
   Owner decision (2026-10-07), not built yet (the follow-up after this slice): a "copy link" action
   on a pending invitation rotates the token like resend, returns the link once, writes an audit row
   and sends no email; it needs `create:users:clinic`, and an invitation on the clinic-admin role
   needs an active admin (§15). Until it ships, this rule and `token: null` stand.
7. **Outbox event `clinic.user_invited`**, one per invite and per resend, with `{ clinicId,
invitationId, email, fullName, language, clinicNameAr, clinicNameEn, roleNameAr, roleNameEn,
expiresAt, reason: "invited" | "resent", sealedToken }`, sealed with the event id as AAD.
8. **Dispatcher contract (next slice).** At send time the dispatcher opens `sealedToken` with the
   event id, re-reads the invitation, and sends only if it is still `pending`, unexpired, and
   `sha256(token) = token_hash`. A cancelled or superseded (rotated) invitation is never mailed.
   Nothing here writes a hash that the latest event's token does not match.
9. **Cancel.** `pending` (expired included) → `cancelled`, hold released; already cancelled →
   200 no-op; accepted → `invitation_used` (409). Resend of a cancelled one →
   `invitation_cancelled` (409), of an accepted one → `invitation_used` (409).
10. **Last admin.** The admin is the member whose role has system key `clinic_admin` (never the
    name). Deactivating or moving the last ACTIVE admin off that role → `last_active_admin` (409),
    decided under the users lock, so parallel deactivations of the last admins serialise.
11. **Deactivation.** After commit the API revokes the member's sessions through
    `MemberSessionRevoker`, then bumps the clinic cache version. The guard already refuses a
    deactivated membership; the revoke ends the sessions themselves. A revoke or invalidation
    failure is logged; the guard and the 30 s TTL cover it. Reactivation counts against the limit
    and needs the member's role to be active.
12. **No-ops** (same role, same branches, already inactive/active, already cancelled) answer 200
    and write nothing: no row, no audit, no invalidation.
13. **Stranded members (resolves ADR-0011's TODO, option b).** A branch exposes
    `exclusiveMemberCount`: active, non-`all_branches` members whose only active branch it is.
    `POST /v1/branches/:id/deactivate` answers 409 `branch_has_exclusive_members` with
    `{ count, members: [{ id, fullName }] }` unless the body has `confirmStrandedMembers: true`.
    It runs after the OD-7 check, under the branch lock; a no-op still answers 200; the audit row
    records `strandedMemberCount`. tenancy reads members through the `ExclusiveMemberReader` port
    that identity implements.
14. **Audit** (one row per change): `invitation.sent|resent|cancelled`,
    `user.role_changed|branches_changed|deactivated|reactivated`. Before/after come from an
    allowlist (name, email, role id + names, allBranches, branchIds, status, expiresAt); never a
    token, hash or sealed token; names go through `maskPhonesInText` and `redactSecrets`.

15. **Only an admin touches the admin role** (owner, 2026-10-07). Granting the clinic-admin role
    (invite, role change), and any write on a member or invitation that holds it (role change,
    branches, deactivate, reactivate, resend, cancel), needs an actor who is an active member on
    that role; anyone else gets 403 `forbidden`. Without it, a custom role holding
    `update:users:clinic` or `create:users:clinic` could promote itself. The check reads the role's
    system key, never its name (`mayTouchAdminRole`).
16. **Users lock, then branches lock, before any branch check.** Invite and resend take `users:`
    then `branches:` before checking the role and branches, so a parallel branch deactivation
    waits and cannot leave a fresh link pointing at a dead branch. Resend re-checks the role and
    branches like an invite (`role_inactive` / `branch_inactive`), and when the old email hold
    expired and was taken over and released meanwhile it reserves the free email again.
    Reactivation also takes the branches lock and refuses (`branch_inactive`) a member limited to
    branches that are all inactive: the admin changes the member's branches first. Acceptance takes
    the branches lock after the invitation row and before checking the grants, so a parallel
    deactivation either commits first (the link is refused) or counts the new member as stranded.
    `exclusiveMemberCount` is 0 for an inactive branch. The decision time (expiry, seats, clinic
    access, a new link's expiry) is read from the clock after the last lock is taken, since waiting
    on a lock may cross an expiry; only the idempotency claim keeps its earlier time. Branch deactivation does not count pending
    invitations; owner decision (2026-10-07): the worker slice (7ب) cancels pending invitations left
    with no active branch, from an outbox event of the deactivation (tenancy never writes
    invitations), releasing the email hold and writing the audit row.
17. **No-ops before validation.** Re-sending a member's current role or branch set answers 200
    and writes nothing, even if that role or one of those branches was deactivated since.

## Consequences

- No new SQL: existing grants (0013, 0016) and the 0015 functions cover every write.
- The clinic area now needs `OUTBOX_SEAL_KEY` too (same key as onboarding).
- Retention of `clinic_idempotency_keys` remains open, as for the platform ledger.
