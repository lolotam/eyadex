# Slice 8 — Custom roles (Phase B)

- Status: in progress
- Date: 2026-10-08
- PRD: §4.6 (Role, RolePermission), §4.7 (catalogue, ready roles, check order), §4.8 (locked
  modules keep their keys), §4.11 (audit), §4.12 (Idempotency-Key, cursor lists), §5.5 item 8,
  §6.3 (RBAC-01, RBAC-03, ISO-02, FLAG-02, AUD-01); stories 45–52.
- ADRs: 0009 (guard + cache), 0010 (feature flags), 0011 (idempotent create, clinic ledger),
  0012 (users lock), new **0017** (this slice).
- Phase-A rules the API must match: `apps/web/src/shared/api/mock/mock-roles.ts` and
  `mock-role-rules.ts`.

## 1. Stories

| Story | What the API does                                                                         |
| ----- | ----------------------------------------------------------------------------------------- |
| 45    | Ready roles exist from onboarding (slice 3a); doctor/receptionist/technician are editable |
| 46    | Create a custom role with an Arabic and an English name, unique per clinic                |
| 47    | Choose its keys from the fixed catalogue (validated by the shared contract)               |
| 48    | Keys of a switched-off module are neither shown nor editable; they are kept as they are   |
| 49    | A role edit applies to every holder on the next request (cache bump, RBAC-03)             |
| 50    | The list shows how many members hold each role                                            |
| 51    | Deactivate only a role nobody holds (`role_in_use` + count)                               |
| 52    | The Clinic Admin role (`is_locked`) refuses every write (`role_locked`)                   |

Deferred item from PR #46 (Codex): the user editor's role and branch pickers must not need
`view:roles` / `view:branches`. Two option reads under `view:users:clinic` serve them.

## 2. Routes

Every route is on the clinic host, declares exactly one `@Require` (ADR-0009) and no
`@RequiresFeature` (roles, users and branches are core modules).

| Route                           | Guard                     | Request                                                  | Response (200 unless noted)      |
| ------------------------------- | ------------------------- | -------------------------------------------------------- | -------------------------------- |
| `POST /v1/roles`                | `create:roles:clinic`     | `createRoleRequestSchema` + `Idempotency-Key` (required) | **201** `RoleSummary`            |
| `PATCH /v1/roles/:id`           | `update:roles:clinic`     | `updateRoleRequestSchema` (whole role)                   | `RoleSummary`                    |
| `POST /v1/roles/:id/deactivate` | `deactivate:roles:clinic` | no body                                                  | `RoleSummary`                    |
| `POST /v1/roles/:id/reactivate` | `deactivate:roles:clinic` | no body                                                  | `RoleSummary`                    |
| `GET /v1/users/role-options`    | `view:users:clinic`       | `optionListQuerySchema` (cursor, limit)                  | `roleOptionListResponseSchema`   |
| `GET /v1/users/branch-options`  | `view:users:clinic`       | `optionListQuerySchema` (cursor, limit)                  | `branchOptionListResponseSchema` |

Reactivation uses the deactivate key, like branches and users.

## 3. Contracts

New file `packages/contracts/src/role-admin.ts`:

- `createRoleRequestSchema = roleInputSchema.strict()` — `{ nameAr, nameEn, permissionKeys }`.
- `updateRoleRequestSchema = roleInputSchema.strict()` — PATCH replaces the whole editable role:
  the key invariants (`unknownPermission`, `oneScope`, `needsView`) are whole-set properties, and
  the web form always sends the whole role.
- `optionListQuerySchema` — the `GET /v1/roles` cursor shape (`cursor?`, `limit` 1–100, default 50).
- `roleOptionListResponseSchema` / `branchOptionListResponseSchema` —
  `{ items: RoleOption[] | BranchOption[], nextCursor, total }` (`id`, names, `isActive`).

Changed: `roleSummarySchema` (`access.ts`) gains `memberCount` = memberships on the role in any
status (the deactivation rule and the web column count these, like the mock). `activeUserCount`
stays.

## 4. Rules (mock parity)

1. **Locked role.** `is_locked = true` (the Clinic Admin) → every write is `role_locked` (409),
   reactivate included. Non-locked ready roles (doctor, receptionist, technician) are editable like
   custom ones (PRD §4.7 table, story 45, mock `enforceNotLocked`).
2. **Catalogue only.** The shared `permissionKeysSchema` refuses unknown keys, two scopes for one
   action, and a write without its view → `validation` (400). Keys are de-duplicated.
3. **Hidden module keys** (`mergeHiddenKeys`): saved keys = requested keys whose module is enabled
   - the role's existing keys whose module is disabled. A requested key of a disabled module is
     dropped; an existing one is kept whatever the input says (FLAG-02). Enabled modules are read
     from `clinic_features` inside the writing transaction.
4. **Unique names.** `lower(btrim(name))` per language per clinic, inactive roles included (0018
   indexes). A violation of `roles_name_ar_unique` / `roles_name_en_unique` → `role_name_taken`
   (409); the index decides, so two parallel creates cannot both pass.
5. **Deactivation.** Refused with `role_in_use` (409, `details.count`) while any membership holds
   the role, deactivated members included (mock `memberCount`). Counted under the per-clinic
   `users:` advisory lock (ADR-0012), then the role row lock, so a parallel role change, invite or
   member reactivation cannot slip a holder in.
6. **No-ops.** Deactivating an inactive role, reactivating an active one, or a PATCH with the same
   names and the same saved key set → 200, nothing written, no audit row, no cache bump.
7. **Inactive roles grant nothing** (already true in `effectivePermissions`); an inactive role can
   still be edited (mock).
8. **Granting is bounded by the actor's own keys.** TODO(spec): neither PRD nor mock settles who
   may grant what. Conservative reading implemented: a create or update may only ADD keys the actor
   currently holds (effective, module-filtered); otherwise `forbidden` (403). Removing keys and
   keeping existing ones are not restricted. The Clinic Admin holds every catalogue key, so it is
   unaffected. Mirrored in the mock.
9. **Pending invitations on a deactivated role.** TODO(spec): not counted by the deactivation rule
   (mock parity, story 51 speaks of users). Such an invitation cannot be accepted while the role is
   inactive (`invitationGrants` → `invitation_invalid`) and works again after reactivation.

## 5. Idempotent create

`Idempotency-Key` required (`idempotencyKeySchema`; missing → `validation`). Claimed in
`clinic_idempotency_keys` inside the create transaction, scope `role:create:<userId>`, hash over
the parsed body with sorted keys. Replay → the same role (201, no second row, no second audit row,
no cache bump); same key + another body → `idempotency_conflict` (409); a failed attempt rolls
back and frees the key.

## 6. Errors

| Code                   | Status | When                                                                |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `validation`           | 400    | body/query/header fails its contract                                |
| `unauthorized`         | 401    | no clinic session                                                   |
| `forbidden`            | 403    | missing permission; granting a key the actor lacks (rule 8)         |
| `not_found`            | 404    | unknown, malformed or another clinic's role id (ISO-02); wrong host |
| `role_locked`          | 409    | write on the locked role                                            |
| `role_in_use`          | 409    | deactivation with holders; `details: { count }`                     |
| `role_name_taken`      | 409    | duplicate Arabic or English name                                    |
| `idempotency_conflict` | 409    | same key, other body                                                |

## 7. Audit (AUD-01)

One administrative `audit_log` row per committed change, `entity_type = 'role'`,
`entity_id` = role id: `role.created` (`after`), `role.updated` / `role.deactivated` /
`role.reactivated` (`before` + `after`). Snapshot allowlist: `nameAr`, `nameEn` (phone-like text
masked with `maskPhonesInText`), `isActive`, `permissionKeys` (sorted). `writeClinicAudit` also
runs `redactSecrets`.

## 8. Cache (ADR-0009)

Every committed change (`changed = true`) calls `AuthorizationInvalidator.clinicChanged(clinicId)`
after commit; a failure is logged and the 30 s TTL covers it.

## 9. RLS impact

None new. `roles` and `role_permissions` already have forced RLS, are in
`db/tests/rls-isolation.sql`, and `eyadex_app` already holds SELECT/INSERT/UPDATE on both (0013)
and DELETE on the `role_permissions` link rows (0016). The name indexes exist (0018). **No SQL
file** (0032 stays unused).

## 10. Tests

Unit (`identity/domain/__tests__/role-rules.spec.ts`): `mergeHiddenKeys`, the write/deactivate/
reactivate decisions, the granting bound, the no-op comparison, the audit snapshot.

API `test:db` (`identity/__tests__/roles-admin.db.spec.ts`, `role-options.db.spec.ts`):

- RBAC-01: each route, a role without its key → 403; no session → 401; platform host → 404.
- happy path of each route (status, body shape parsed with the contract).
- locked role: update, deactivate, reactivate → `role_locked`; ready doctor role is editable.
- ISO-02: another clinic's role id → 404 and the row unchanged; malformed id → 404.
- duplicate name (case and spaces ignored) → `role_name_taken`, on create and update.
- idempotent replay (one row, one audit row) and changed body → `idempotency_conflict`; missing key.
- catalogue: unknown key / two scopes / write without view → `validation`.
- module locked: the role's patients keys are kept on update; requested ones are dropped.
- `role_in_use` with a count that includes deactivated members; free role deactivates/reactivates.
- granting bound: an actor with `create:roles` but not `view:patients` cannot grant it.
- audit row content (allowlisted keys, masked phone in a name).
- RBAC-03: a member's `/v1/me` permissions change on the next request after a role update.
- option reads: a role holding `view:users` but not `view:roles`/`view:branches` gets both lists;
  inactive branches included; another clinic's rows never listed; without `view:users` → 403.

Every negative test is proven to fail with its guard removed (report).

Web vitest: each wired method (`roles.create/update/deactivate/reactivate`,
`users.listRoleOptions/listBranchOptions`) checked for method, path, body, headers
(`Idempotency-Key` on create only) and `credentials: "same-origin"`; mock tests for replay,
conflict, granting bound; `roleWriteAccess` follows permissions in both modes.

## 11. Implementation plan

1. Contracts: `role-admin.ts`; `memberCount` on `roleSummarySchema`.
2. Domain `identity/domain/role-rules.ts` (+ unit tests).
3. Persistence `identity/persistence/pg-role-store.ts`; queries `identity/queries/role-summary.ts`
   (one role, the list's shape) and `identity/queries/user-options.ts`; `list-roles.ts` adds
   `member_count`.
4. Use case `identity/use-cases/role-changes/role-changes.ts` (BranchChanges shape).
5. HTTP `identity/http/roles.controller.ts`, `identity/http/user-options.controller.ts`;
   `identity/roles.module.ts`; one-line mounts (`identity/index.ts`, `app.ts`); three status lines in
   `shared/errors.ts`.
6. API db tests + negative-test proofs.
7. Web: `api-client.ts` create signature; `http-roles.ts`, `http-users.ts`; mock replay + granting
   bound; `role-form-dialog.tsx` key; `roleWriteAccess` without mode; tests.
8. ADR-0017, roadmap bullet; gates; push.
