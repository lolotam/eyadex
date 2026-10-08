# ADR-0017: Custom roles — writes, locked role, hidden keys, granting bound, option reads

- Status: accepted
- Date: 2026-10-08
- Slice: Phase B slice 8 (PRD §4.6–§4.8, §4.11, §4.12; stories 45–52; RBAC-01/03, ISO-02,
  FLAG-02, AUD-01). Spec: `docs/specs/slice-08-custom-roles.md`.

## Context

Slice 4 served the role reads (`GET /v1/roles`, the catalogue) and slice 7 the users that hold
roles. The Phase-A mock (`mock-roles.ts`, `mock-role-rules.ts`) already fixes the business rules a
clinic admin sees: the Clinic Admin role is locked, names are unique, keys come from the catalogue,
a switched-off module's keys survive an edit, and a role with members cannot be deactivated. Codex
on PR #46 also deferred one item: the user editor read its pickers from `/v1/roles` and
`/v1/branches`, so an admin of users needed `view:roles` and `view:branches` too.

## Decision

1. **Routes.** `POST /v1/roles` (`create:roles:clinic`, required `Idempotency-Key`, 201),
   `PATCH /v1/roles/:id` (`update:roles:clinic`), `POST /v1/roles/:id/deactivate` and
   `/reactivate` (`deactivate:roles:clinic`). Every write answers `RoleSummary`, the list's shape.
   PATCH carries the whole editable role (`nameAr`, `nameEn`, `permissionKeys`): the key rules
   (one scope per action, a write needs its view) are whole-set properties.
2. **Locked, not "system".** The gate is `is_locked`: the Clinic Admin refuses every write with
   `role_locked` (409). The other ready roles (doctor, receptionist, technician) are editable, as
   PRD §4.7 ("قابل للتعديل: نعم") and story 45 say and the mock does. The slice brief read "system
   roles refuse every write"; PRD wins on scope (CLAUDE.md), so the orchestrator is told.
3. **Hidden module keys (FLAG-02).** Saved keys = requested keys whose module is enabled + the
   role's existing keys whose module is disabled (`mergeHiddenKeys`, pure, mirrors the mock: a
   requested key of a disabled module is dropped). Enabled modules are read from `clinic_features`
   inside the writing transaction, not from the cached request context.
4. **Unique names.** The 0018 indexes decide (`lower(btrim(name))` per language, inactive roles
   included); a `DatabaseError` on `roles_name_ar_unique` / `roles_name_en_unique` maps to
   `role_name_taken` (409), so two parallel writes cannot both pass.
5. **Deactivation (story 51).** `role_in_use` (409, `details.count`) while any membership holds
   the role, deactivated members included (mock `memberCount`). The count is read under the
   `users:` then `branches:` advisory locks (ADR-0012 order) and the role row lock: role changes,
   invites and member reactivations hold the first, invitation acceptance the second, so a holder
   cannot slip in between the count and the update. Every role write takes the `roles:` lock
   first (rule 6).
6. **Delegation model (Codex round 2 on `a2ace7d`; replaces the earlier
   context-permission bound).** One domain module, `identity/domain/grant-rules.ts`, decides it
   on the actor as the database holds it, never on the request context (that one is filtered by
   module and cached for up to 30 s):
   - **Role definition writes** (create, update, deactivate, reactivate): the actor's membership
     and role are active, the membership has `allBranches = true` (roles are clinic-wide), and its
     **stored** role keys — every module, switched-off ones included — cover the target role's
     keys as they are and, for create/update, as they will be. A `clinic` key covers the same
     action at `branch` scope (`grantFor`). TODO(spec): a looser delegation model needs an owner
     decision.
   - **Role grants** (change role, change branches, invite, resend, copy link, member
     reactivation): the same stored-key coverage of the granted role, plus **data-scope
     containment**: an all-branch target needs an all-branch actor; otherwise the target's
     branches must be among the actor's active branches. Change role checks the member's
     existing scope (it keeps it); change branches checks the new scope. Slice 7 enforced no
     actor scope on invite or change branches, so nothing is duplicated.
   - Otherwise 403 `forbidden`. It is a permission/scope check, never a role-name check; the Clinic
     Admin (whole catalogue at clinic scope, all branches) passes everything, and ADR-0012 §15's
     admin-role guard stays.

   **Where and when.** Every one of those paths takes `pg_advisory_xact_lock(hashtextextended(
'roles:' || clinic_id, 0))` as its first lock, then its existing `users:` → `branches:` →
   row locks, and only then reloads the actor (membership status, `all_branches`, active
   branches, role status, `role_permissions`) — so a revocation committed while the request
   waited is what the decision sees. Role update and deactivate are revocations and take the same
   first lock. **No deadlock:** the advisory locks are always taken in the one order `roles:` →
   `users:` → `branches:`, `roles:` only ever as the first statement-level lock of a transaction,
   and no path takes `roles:` after any other lock; the paths that do not take `roles:` (branch
   writes, invitation cancel and acceptance, worker) keep their unchanged ADR-0011/0012 orders,
   which already start at `users:` or `branches:` or an invitation row and never wait for
   `roles:`. Row locks (role row, membership row, invitation row) come after the advisory locks
   in every path that takes `roles:`.

7. **Idempotent create.** Scope `role:create:<userId>` in `clinic_idempotency_keys` (ADR-0011),
   hash over the parsed body with sorted keys (a key set is a set). Replay → same role, no second
   row or audit row, no cache bump; another body → `idempotency_conflict`.
8. **No-ops** (same names and key set, deactivating an inactive role, reactivating an active one)
   write nothing, audit nothing and do not invalidate.
9. **Audit (AUD-01).** One administrative row per change: `role.created` (`after`),
   `role.updated` / `role.deactivated` / `role.reactivated` (`before` + `after`), allowlist
   `nameAr`, `nameEn` (phone-like text masked), `isActive`, `permissionKeys` (sorted).
   `redactSecrets` treated `permissionKeys` as a credential name (it ends in "key"), which blanked
   the keys; `permissionkeys` joins the structural exemptions in `@eyadex/observability` — catalogue
   strings are not secrets.
10. **Cache (RBAC-03).** Every committed change calls `AuthorizationInvalidator.clinicChanged`
    after commit; a failure is logged and the 30 s TTL covers it (ADR-0009).
11. **List counts.** `RoleSummary` gains `memberCount` (memberships in any status) beside
    `activeUserCount`, so the web column and its `role_in_use` warning count what the API counts.
    The keys aggregate as `jsonb`: the pool runs with `fetch_types: false`, so the previous
    `array_agg` arrived as the literal `"{…}"` and failed the contract.
12. **Option reads.** `GET /v1/users/role-options` and `/branch-options` under
    `view:users:clinic`, cursor-paged like every list (PRD §4.12), fields `id`, names, `isActive`,
    inactive rows included (the editor names a member's past role and branches). The web adapter
    reads them instead of `/v1/roles` and `/v1/branches`.
13. **Placement.** Domain, store, queries, use case and controllers live in `identity` (it owns
    roles); a `RolesModule` mounts them beside `ClinicAccessModule` under `mountClinic`. No SQL: RLS,
    grants (0013, 0016) and indexes (0018) already exist.

## Consequences

- TODO(spec): a pending invitation on a deactivated role is not counted by rule 5 (mock parity;
  story 51 speaks of users). It cannot be accepted while the role is inactive (`invitationGrants`)
  and works again once the role is reactivated.
- Rule 6 also tightens slice-7 paths (change role, change branches, invite, resend, copy link,
  member reactivation): a member with `update:users` or `create:users` can only hand out roles its
  own stored keys cover, inside its own branch scope. If a further review still finds a
  delegation hole, the feature narrows to admin-equivalent actors only.
- The web offers role writes in both API modes (`roleWriteAccess` follows permissions only).
