# ADR-0022 — Retention of the idempotency ledgers and the outbox

- Status: accepted (owner decision 2026-10-09)
- Date: 2026-10-09

## Context

Three technical ledgers grow forever: the platform idempotency ledger `idempotency_keys` (0025, ADR-0006),
the clinic ledger `clinic_idempotency_keys` (0028, ADR-0011) and `outbox_events` (0025, 0029, ADR-0013).
ADR-0006, ADR-0011, ADR-0012 and ADR-0013 left their retention as `TODO(spec)`. No runtime role may delete
from any of them today, `clinic_idempotency_keys` is under forced RLS, and no runtime role has `BYPASSRLS`.

## Decision

### 1. Periods (owner decision 2026-10-09)

| Ledger                                        | Deleted                   | Rule (`now()` of the database)                |
| --------------------------------------------- | ------------------------- | --------------------------------------------- |
| `idempotency_keys`, `clinic_idempotency_keys` | 30 days after the claim   | `created_at < now() - 30 days`                |
| `outbox_events`, dispatched (sent or skipped) | 30 days after the outcome | `dispatched_at < now() - 30 days`, not failed |
| `outbox_events`, failed for good              | 90 days after giving up   | `failed_at < now() - 90 days`                 |
| `outbox_events`, pending or retrying          | never                     | both timestamps `NULL`, at any age            |

The outbox states come from the dispatcher's only writer (`packages/db/src/dispatcher.ts`): `dispatched`
sets `dispatched_at`; `failed` (the fifth failure, `invalid_payload`, `seal_unreadable`) sets `failed_at`;
`retry` sets neither, only `next_attempt_at`. An event of a type no handler claims stays pending and is
never deleted. A row with both timestamps (the dispatcher never writes one) waits for the 90-day rule.

The periods live in one place: the three function bodies of `db/sql/0040_retention.sql` (named `CONSTANT`
locals), mirrored by this table. The worker carries no period at all, only its batch size and schedule.

### 2. Three SECURITY DEFINER functions (SQL 0040)

`purge_expired_outbox_events(p_limit)`, `purge_expired_idempotency_keys(p_limit)` and
`purge_expired_clinic_idempotency_keys(p_limit)`, the pattern of 0014/0027/0037:

- Owned by the new `eyadex_retention_owner` (`NOLOGIN NOBYPASSRLS`), `search_path = public, pg_temp`,
  `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` to `eyadex_dispatcher` only.
- Each computes its cutoff from `now()`; the only argument is the batch size, refused outside `1..1000`
  (`invalid_parameter_value`). A call deletes at most `p_limit` rows (the outbox's two rules share the
  limit), oldest first, with the rule repeated in the outer `DELETE` so a row that changed meanwhile is
  re-checked. It returns the count only.
- The owner holds `SELECT` on the columns its rules read and `DELETE` on the three ledgers, nothing else:
  no payload, no stored response, no request hash, and no grant on any other table (the audit logs and
  `patients` included).
- Both RLS tables force RLS on the owner too, so it has its own policies: on `outbox_events`
  `USING (dispatched_at IS NOT NULL OR failed_at IS NOT NULL)` — a pending or retrying event is out of its
  reach whatever a function body says — and on `clinic_idempotency_keys` `USING (true)` (every clinic,
  like 0027's lookup). `idempotency_keys` has no RLS (0025).
- Indexes for the order each rule reads: partial `(dispatched_at)` and `(failed_at)` on the outbox,
  `(created_at)` on both ledgers. The clinic ledger's index serves the owner's cross-clinic purge, not a
  tenant query or an RLS predicate (the primary key serves those), so it does not start with `clinic_id`.

**Why functions, not grants.** A plain `GRANT DELETE` hands the caller the `WHERE` clause: it could delete
a fresh key (a live replay answer) or a pending event (a lost email). The function fixes the rule and the
batch cap in the database. A restrictive RLS policy could fix the rule but not the batch size.

**Why the dispatcher.** It is the one runtime role the API never signs in as; `eyadex_app` and
`eyadex_platform` are the API's roles too, so granting them would let the API purge. Its table grants stay
on `outbox_events` alone (PRD §4.5): it reaches the two key ledgers only through the two functions, which
reveal nothing and touch only expired rows. Its pool already exists in the worker, so no new role, login
or secret is needed. `createDispatcherOutbox` gains one method, `purgeExpired(target, limit)`, mapping
`outbox` / `platformLedger` / `clinicLedger` to the three fixed statements — still no SQL from the caller.

### 3. The worker job

`RetentionPurgeJob` (`apps/worker/src/retention/`) runs at start and then every
`RETENTION_PURGE_INTERVAL_MS` (default one hour, 60 000 to 86 400 000, like `EXPIRY_SCAN_INTERVAL_MS`),
after the previous run ends (`shared/periodic-job.ts`, now also the expiry scan's scheduler). Per ledger it
deletes batches of 500 (each its own short transaction) until a batch comes back short, at most 20 batches
per run; what is left waits for the next run (`backlog` in the log line). A failing ledger is logged
(`retention purge failed`) and does not stop the others. The run logs counts only:
`{ retention: { purged: { outbox, platformLedger, clinicLedger }, backlog, failed } }`. It is idempotent: a
deleted row never comes back, and a second worker replica only waits on the rows the first is deleting.
`stop()` lets the batch in flight finish before the pools close.

Hourly rather than daily: the cutoff is computed by the database, so the tick only bounds how long an
expired row lingers (at most one interval) and keeps each run small.

### 4. Why deleting is allowed here

CLAUDE.md §5 forbids hard deletes of users, branches, roles and patient files: those are business records
whose history matters. These rows are technical: an idempotency key is a replay guard whose only use is a
retry of the same request, and an outbox row is a delivery ticket whose outcome is already recorded where
it matters (the invitation's status, the clinic audit log, the reminder ledger). Nothing reads either once
its period is over. The audit logs (`audit_log`, `platform_audit_log`) are never touched — the owner has no
grant on them.

### 5. A replay after the purge

`claimIdempotencyKey` / `claimClinicIdempotencyKey` insert the key with `ON CONFLICT DO NOTHING`. Once a key
is purged, the same `Idempotency-Key` with the same body is a **new** claim and the create runs again.

- Who could send it: the web keeps a key in memory for one open form (`crypto.randomUUID()` per dialog or
  page), and a retry follows a failed response within seconds or minutes. A replay 30 days later needs the
  same form left open for a month and resubmitted after an earlier submit that succeeded but whose answer
  was lost. That is outside any realistic retry window.
- What natural keys still catch then: a clinic (`slug_taken`, the admin's `email_taken` hold), an invitation
  or a team invite (the email hold), a role (`role_name_taken`), a patient with a civil ID (`patient_civil_id_taken`). A branch
  or a patient without a civil ID would be created twice; both can be deactivated or archived.
- Races: a purge that deletes a key while a replay of it runs makes the replay's read find no row, so it
  answers `idempotency_conflict` (409) — safe, nothing is created twice. A claim waiting on a purge's
  uncommitted delete inserts a fresh key once the purge commits.

## Consequences

- Production and staging need SQL 0040 applied before the worker that calls it starts; a worker that starts
  first logs `retention purge failed` each run and keeps dispatching. `RETENTION_PURGE_INTERVAL_MS` is
  optional.
- The first run on an old database deletes at most 30 000 rows (3 × 20 × 500) and leaves the rest to the
  following runs.
- `db/tests/retention.sql` proves the grants, the periods on both sides, pending and retrying events at any
  age, both clinics, the batch cap and that a second pass deletes nothing; it rolls back.
- TODO(spec): none of the periods is configurable per clinic; changing one is a new SQL file.
