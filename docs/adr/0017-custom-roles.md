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
   cannot slip in between the count and the update. Create and update take only the row lock.
6. **Granting bound.** TODO(spec): the PRD does not say who may grant what, and a holder of
   `update:roles:clinic` could otherwise grant itself every key. Conservative reading: a write may
   only ADD keys the actor holds (effective, module-filtered; a `clinic` key covers the same
   action at `branch` scope, as `grantFor` does). Keeping or removing keys is free; the Clinic
   Admin holds the whole catalogue at clinic scope, so it is unaffected. `forbidden` (403)
   otherwise. The mock enforces the same.
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
- TODO(spec): the granting bound (6) needs an owner decision; lifting it is a one-function change
  in `role-rules.ts` and `mock-roles.ts`.
- The web offers role writes in both API modes (`roleWriteAccess` follows permissions only).
