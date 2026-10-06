# ADR-0010 — Feature flags, subscription and limits

- Status: accepted (Phase B slice 5)
- Date: 2026-10-06

## Context

PRD §4.8 (module flags per clinic, platform-controlled) and §4.9 (status, expiry, user/branch
limits); stories 9–15, 18; tests FLAG-01/02, SUB-01/02/03. ADR-0009 left step 3 of the check order
(the module gate) as an extension point.

## Decision

**Module gate.** A route declares its module with `@RequiresFeature(module)`, next to its one access
declaration (it is not one). `AccessGuard` checks it after the membership and subscription steps and
before the permission: a locked module → 403 `module_disabled` (`details.module`). Defence in depth:
a `@Require` key whose catalogue `module` is locked is not granted (403 `forbidden`) even on a route
without `@RequiresFeature`. `assertRouteAccess` refuses to boot when a route's `@Require` key belongs
to a module the route does not declare; a unit test covers the walk.

**A missing `clinic_features` row means locked.** Onboarding always writes one row per module (the
request carries `modules`, so specialty defaults stay a client choice, PRD §4.8); a missing row is
incomplete data, and default deny is the safe reading. This resolves the earlier `TODO(spec)`.

**Locked modules disappear, nothing is deleted.** `effectivePermissions` drops keys of locked modules;
`/v1/me` returns those effective keys plus `modules` (the enabled list); the catalogue leaves locked
modules out. `role_permissions` rows are never touched by a flag change, so re-enabling restores the
exact previous effect (FLAG-02).

**Cache.** The member snapshot (ADR-0009) now carries `clinic.enabledModules`; its key prefix moved
to `m2` so a pre-slice-5 entry is never read as a new one. Same version, same 30 s TTL, same
Redis-down fallback to the database.

**Platform endpoints** (`@PlatformStaff`, `eyadex_platform` pool, one transaction each, the clinic
row locked `FOR UPDATE`, exactly one `platform_audit_log` row with allowlisted before/after):

| Route | Audit action | Allowlisted details |
| --- | --- | --- |
| `GET /v1/platform/clinics/:id` | — | — |
| `PUT …/:id/features/:module` `{ enabled }` | `clinic.feature_changed` | `module`, `enabled` |
| `PATCH …/:id/subscription` | `clinic.subscription_changed` | `status`, `expiresAt` |
| `PATCH …/:id/limits` | `clinic.limits_changed` | `maxUsers`, `maxBranches` |

Every write answers with the detail. After the commit the controller calls
`AuthorizationInvalidator.clinicChanged`; if that fails it logs and relies on the 30 s TTL. An
unknown or malformed clinic id, or an unknown module, is 404. No `Idempotency-Key`: PUT/PATCH set
absolute values, so a replay writes the same state again (and one more audit row, which is a true
record of the call).

**Expiry input.** Either `durationDays` (from now on the injected Clock) or `expiresAt` (taken as
given, even in the past: the platform may end access on purpose), never both; at least one field.
"Expired" stays computed, never stored; reactivation is just a status/expiry change, data untouched.

**Lowered limits.** A limit below current usage is accepted and only blocks new creates; existing
users and branches are not affected (PRD §4.9). The detail shows `used > max` in that case.

**Limits port.** tenancy's `ClinicLimits` (`canAddUser`, `canAddBranch` → `LimitCheck`), implemented by
`ReaderClinicLimits` over `ClinicReader` + identity's `SeatUsageReader`. Callers reject with
`limit_reached` (409) and `limitReachedDetails` `{ resource, used, max }`.

**Detail on the platform pool.** `PgClinicReader` and `PgSeatUsageReader` are instantiated on
`eyadex_platform` (SELECT on clinics, features, branches, memberships, invitations — nothing on
patients). The response schema is strict and has no patient field (PLAT-02, schema test).

## Consequences

- Open (slices 6–7): `ClinicLimits` reads outside the caller's transaction; two concurrent creates at
  the limit can both pass. The creating slice must lock the clinic row (or recount) inside its
  transaction.
- Open: a failed post-commit invalidation leaves old access for up to 30 s, including a suspension.
