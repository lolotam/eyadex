# ADR-0008 — Accepting an invitation

- Status: accepted (Phase B slice 3b)
- Date: 2026-10-05

## Context

PRD stories 28/57 and INV-01: an invitee opens the link, sets a password and becomes a clinic member.
Two database roles are involved: the account lives in Better Auth's tables (`eyadex_auth`), the
membership in the clinic's tables (`eyadex_app` under `withTenant`). One transaction cannot span both
pools, and CLAUDE.md §5 forbids hard deletes of users, so a compensating delete is not an option.

## Decision

- **Routes.** `POST /v1/invitations/inspect` `{ token }` and `POST /v1/invitations/accept`
  `{ token, password }`, clinic host only (`ClinicAreaGuard`: platform or unknown host → 404), no
  session. The token travels in the body only, is hashed (SHA-256) at once, and the request log line
  holds the route pattern only. Password bounds are `PASSWORD_LIMITS` (a test pins the contract to them).
- **One answer.** Used, expired, cancelled, unknown, a blocked clinic, or a role/branch switched off
  since: all `invitation_invalid`, HTTP **404**. Not 410: "gone" would confirm the link once existed.
- **Order.** (1) `invitation_clinic_for_token(hash)` with no tenant (0014). (2) `withTenant(clinic)`:
  `SELECT … FOR UPDATE` the pending, unexpired invitation — every accept of the link is serialised
  here, and a waiter re-reads `accepted` and gets `invitation_invalid`. (3) Still holding the lock, the
  auth account is created on `eyadex_auth` (its own short transaction). (4) Same clinic transaction:
  convert the email hold (0015), insert the membership (+ `membership_branches` when not
  all-branches), mark the invitation `accepted` with `responded_at`, write the audit row
  (allowlisted fields; no token, hash or password). Commit.
- **Reuse instead of delete.** The email is held for THIS invitation (0015/0017), so a clinic-area
  account with that email and no membership can only be a previous attempt of the same link that
  failed after step 3. It is reused: its password is replaced through Better Auth's own hasher
  (`setAccountPassword`, which also revokes its sessions).
- **Other area.** An account with the email in the platform area is never reused (one account, one
  area — ADR-0003/0004, 0024): `account_other_area` (409), nothing written.
- **No sign-in.** The response is `{ clinicId, email }` and sets no cookie; the UI sends the user to
  the normal sign-in, so sessions keep one creation path (and its area hook).
- **No Idempotency-Key.** Accepting is single-use by construction; a replay is `invitation_invalid`.
- **Rate limits** (ADR-0005 limiter, Redis, fail closed with 503): both routes per client IP
  30 / 10 min, accept per token hash 10 / 15 min (`public-rate-limits.ts`, TODO(spec) values).
  `PublicRateLimitGuard` refuses a sessionless /v1 route that is not listed, and a test walks every
  controller to prove each sessionless POST is listed and guarded.

## Failure matrix

| Fails at                                      | State left                         | Retry of the same link                    |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| token lookup / row lock                       | nothing                            | works                                     |
| account creation (step 3)                     | nothing (user + credential atomic) | works                                     |
| anything in step 4, or the commit             | auth account only, clinic rolled back | works: account reused, password replaced |
| after the commit (response lost)              | accepted                           | `invitation_invalid`; user signs in       |
| parallel accept                               | the first wins                     | the second gets `invitation_invalid`      |

## Consequences

- An orphan clinic account (no membership) can exist between a failed attempt and its retry; it has
  no session and cannot sign in to anything useful — every clinic route checks the membership.
  TODO(spec): a sweep for orphans whose invitation then expired.
- No new SQL was needed: `eyadex_app` already has the grants and functions (0013–0017).
