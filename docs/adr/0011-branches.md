# ADR-0011: Branches — limit lock, idempotent create, OD-7, member effect

- Status: accepted
- Date: 2026-10-06
- Slice: Phase B slice 6 (PRD §4.6, §4.9, §4.11, OD-7; stories 31–34, 17)

## Context

Branch create, update, deactivate and reactivate are the first clinic-side writes that consume a
limit (`max_branches`) and change the cached branch scope (ADR-0009). PRD §4.6 adds an address and
a phone to the branch; the table had neither.

## Decision

1. **SQL 0028** adds nullable `branches.address` and `branches.phone`. eyadex_app already had
   SELECT/INSERT/UPDATE on `branches` (0013) and still has no DELETE.
2. **The limit is decided inside the write transaction, under a per-clinic lock.** Create,
   deactivate and reactivate take `pg_advisory_xact_lock(hashtextextended('branches:' || clinic_id, 0))`
   first, then count active branches and read `max_branches`. Not `clinics … FOR UPDATE`: row locks
   need UPDATE on `clinics`, and eyadex_app must not get one (the platform owns subscription and
   limits). Not the `ClinicLimits` port either: it reads outside the transaction, so two parallel
   creates at limit − 1 would both pass. The port stays for read-only usage displays. The lock is
   transaction-scoped (the statement guard refuses the session form), so it ends at COMMIT/ROLLBACK.
   A hash collision between two clinics only serialises them; it never lets one through.
3. **Reactivation counts against the limit** like a create (`decideBranchReactivation`).
   Deactivated branches never count.
4. **Idempotent create.** `POST /v1/branches` requires `Idempotency-Key` (scope =
   `branch:create:<userId>`), claimed in the same transaction. A replay returns the same branch
   without a second row, audit row or limit slot; a different body under the same key is
   `idempotency_conflict`; a failed attempt (e.g. `limit_reached`) rolls back and frees the key.
   The claim lives in a new clinic table `clinic_idempotency_keys` (forced RLS on `clinic_id`, in
   the isolation test), not in `idempotency_keys` (0025): that ledger has no clinic column, so a
   grant to eyadex_app would let one clinic read another's stored responses.
5. **OD-7 under concurrency.** Deactivation takes the same clinic lock, then the row lock, so two
   parallel deactivations of the last two active branches serialise and the second sees one active
   branch → `last_active_branch` (409). Lock order is always clinic lock → row lock.
6. **No-op changes** (deactivating an inactive branch, reactivating an active one, a PATCH with the
   current values) answer 200 with the branch, write nothing, audit nothing and do not invalidate.
7. **Audit (AUD-01).** One administrative `audit_log` row per change: `branch.created` (after),
   `branch.updated` / `branch.deactivated` / `branch.reactivated` (before + after), fields from the
   allowlist `branchAuditSnapshot` only (names, address, phone, isActive). The append-only audit
   keeps no full phone number: the snapshot stores `maskPhone` (last 3 digits), and
   `writeClinicAudit` passes every `details` through `redactSecrets`, so a token or civil ID typed
   into a free-text field (a name, an address) is not kept either.
8. **Members of a deactivated branch.** `membership_branches` rows are kept (no hard delete), and
   the member's effective branches are only the active ones (the member reader already joins on
   `is_active`). A member whose only branch is deactivated keeps the membership but reaches nothing
   branch-scoped; reactivating restores the exact previous scope. `all_branches` members are
   unaffected.
   Resolved (owner, option b): deactivating a branch that is some members' only active branch
   answers 409 `branch_has_exclusive_members` unless the body confirms it — see ADR-0012.
9. **Cache.** Every committed change calls `AuthorizationInvalidator.clinicChanged` after commit;
   a failure is logged and the 30 s TTL covers it (ADR-0009).
10. **Platform read (story 17).** `GET /v1/platform/clinics/:id/branches` (`@PlatformStaff`,
    platform pool, which 0013 grants SELECT on `branches`) lists a clinic's branches read-only
    with the same filters and cursor as the clinic list; an unknown clinic is 404.
11. **Placement.** Use cases and SQL live in `tenancy` (it owns branches); the HTTP controller lives
    in `identity` beside the guard and the invalidator (identity → tenancy is an allowed arrow).
12. **ISO-02.** Another clinic's branch id, or a malformed one, answers 404, never 403.

## Consequences

- Slice 7 (users) reuses the same pattern for the seat limit: an in-transaction lock + count.
- `clinic_idempotency_keys` retention is open, like `idempotency_keys` (0025).
