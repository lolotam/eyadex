# ADR-0009 — The authorization guard

- Status: accepted (Phase B slice 4)
- Date: 2026-10-06

## Context

PRD §4.7 fixes a check order for every clinic request and asks for permissions and clinic state to
be cached in Redis and invalidated on every change. CLAUDE.md §6: no endpoint without a guard,
default deny, never check role names. Slices 5–8 (feature flags, branch/user/role CRUD) all build
on this layer.

## Decision

**One declaration per route (RBAC-04).** Every handler carries exactly one of `@Public()`,
`@Authenticated()` (clinic session + active membership + allowed clinic, no permission — `/me`),
`@Require(key)` (the same plus the permission) or `@PlatformStaff()` (platform host, platform
session, verified TOTP; no roles inside the platform team in the MVP, PRD §7). The decorators append
to a list, so two declarations stay visible. A global `AccessGuard` (APP_GUARD, runs before every
controller guard) answers 500 for zero or two; `assertRouteAccess` refuses to boot such an app; a
test walks every registered route. `@Require` takes `PermissionKey`, a literal union pinned to
`PERMISSION_CATALOG` (unit test), which is pinned to the 0026 seed (db test).

**Check order** (default deny, each step throws):

| Step | Check                                                       | Failure                          |
| ---- | ----------------------------------------------------------- | -------------------------------- |
| 0    | host = the rule's area                                      | 404 `not_found`                  |
| 1a   | session of that area (area-bound lookup, ADR-0003)          | 401 `unauthorized`               |
| 1b   | a membership exists for the user                            | 403 `forbidden`                  |
| 1c   | the membership is active                                    | 401 `account_disabled`           |
| 2    | clinic not suspended and `expires_at` > Clock.now()          | 403 `subscription_blocked` + reason |
| 3    | module enabled — `moduleEnabled()`, filled by slice 5        | `module_disabled`                |
| 4    | role holds the key (`grantFor`; a `clinic` key also covers a `branch` requirement, never the reverse) | 403 `forbidden` |
| 5    | branch scope: `all_branches` or the active `membership_branches`, put on the context | queries filter |

The request then carries `ClinicRequestContext { userId, clinicId, membershipId, roleId,
permissions, branchScope }`; all tenant work still goes through `withTenant(clinicId)` and RLS.

**Finding the clinic.** A session names a user, not a clinic. `membership_clinic_for_user(user_id)`
(0027, SECURITY DEFINER, owned by a NOLOGIN role, executable by `eyadex_app` only) returns the clinic
id only; a unique index on `memberships(user_id)` makes "one account, one membership" a database
rule. It is the third named pre-tenant path (CLAUDE.architecture.md §3).

**Cache.** Redis keys (ids only, no personal data):

- `eyadex:authz:ver:<clinic>` — the clinic's version, `INCR` on every change;
- `eyadex:authz:m:<clinic>:<version>:<user>` — the member snapshot (membership, role, keys, branches,
  clinic status and expiry), TTL 30 s;
- `eyadex:authz:uc:<user>` — the user's clinic, TTL 1 h (a membership never moves clinic).

The version is read before the database, so a change committed during a read bumps the version and
the stale snapshot lands under a key no request reads again. An entry is used only for the exact
clinic and user it names. Expiry is evaluated on every request from the snapshot and the injected
Clock (SUB-02: no job, no invalidation needed); suspension needs an invalidation (SUB-01).

**Invalidation points** (port `AuthorizationInvalidator.clinicChanged`, called after commit): role
created/edited/deactivated, role permissions changed, membership role/branches/status changed,
branch deactivated, clinic status/expiry/feature changed. Slices 5–8 call it; this slice provides it.
`MemberSessionRevoker` (revoke a deactivated member's sessions, PRD §4.10) is provided for slice 7.

## Failure matrix

| Fails                         | Effect                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| Redis read                    | read the database; the same decision as with no cache, never "allow" |
| Redis write                   | not cached; the next request reads the database                     |
| invalidation (Redis down)     | the caller sees the error; an old entry can live ≤ 30 s (TTL)        |
| database                      | 500 `unknown` (no decision without data)                            |
| route without one declaration | boot fails; at runtime 500                                          |
| auth or clinic context not mounted | any non-public route answers 500                               |

Failing to the database (not closed) keeps clinics working through a Redis outage without ever
widening access: the cache only ever holds what the database said.

## Consequences

- TODO(spec): platform account deactivation is not modelled yet; `@PlatformStaff` will check it when
  the platform team slice adds it.
- Reads (`/me`, `/roles`, catalogue) write no audit rows.
