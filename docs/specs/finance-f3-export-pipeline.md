# Finance F3 — the export pipeline (design)

- Status: **decided** (2026-10-23). This is the design issue #105 asked for. Nothing here is built.
- Parent spec: `docs/specs/finance-f3-reports-design.md` (§7 exports, §7.3 the export table, §8 the SQL
  plan, §12 the owner decisions). §7.2 and §7.3 of that file point here.
- Issue: #105 ("F3: design the finance export pipeline"). Its six binding requirements are met below.
- Vocabulary: an **export** is one requested report file. An **attempt** is one try to build it. The
  **lease** is the right to work on an export row. The **fence** is the check that a worker still owns
  its attempt. The **blob** is the file in the private store.
- Rules it inherits and does not change: the outbox is the only durable queue (no queue library in
  `apps/worker`), no new database role, no `BYPASSRLS`, the worker reads only inside
  `withTenant(clinicId)`, the access is re-checked at run time (parent §7.4), and the export row is
  never deleted.

## 1. Scope

In scope:

- the hand-off from the API's request to the worker,
- the lease, the heartbeat, the attempts and the fenced publish,
- the failure, the retry and the takeover rules,
- the blob keys, the cleanup of every key ever allocated, and the 24-hour retention,
- the exact columns of the two tables slice 2's SQL needs.

Out of scope:

- the report queries and the CSV and XLSX writers (parent §5 and §7.1),
- the download route and the re-check it repeats (parent §7.4),
- the content of the audit rows (parent §7.4),
- the web screen (parent slice 5),
- the blob deletion itself: the `delete` on the port and the `s3:DeleteObject` grant are a server
  change that lands before slice 4 and that slices 1 to 3 never need (§11).

Where the code goes (parent slice 4): `apps/worker/src/finance-exports/`.

| File                               | What it holds                                           |
| ---------------------------------- | ------------------------------------------------------- |
| `handle-export-requested.ts`       | the claim handler: the hand-off only, no build          |
| `export-runner.ts`                 | the local queue, the heartbeat and the build            |
| `persistence/pg-export-store.ts`   | the lease, the heartbeat, the blob rows and the publish |
| `persistence/pg-export-sweeper.ts` | the expiry sweep and the cleanup of every allocated key |
| `domain/export-key.ts`             | the blob key layout                                     |
| `domain/export-failures.ts`        | the failure kinds and the backoff ladder                |
| `ports/blob-store.ts`              | the worker's blob port: `put`, `get`, `delete`          |

The API side stays in the `billing` module (`apps/api/src/modules/billing/`), because the billing
module owns the finance tables (ADR-0033, ADR-0034).

The event type `finance.report_export_requested` joins the worker's route map in
`apps/worker/src/main.ts`, next to the other handlers.
It is claimed by a **poller of its own**, so the backpressure of the export runner (§2 step 5) never
pauses the other event types of the shared poller.

One shared change: `OutboxPoller` (`apps/worker/src/shared/outbox-poller.ts`) gains an optional
`afterClaim` hook, called after `claimNext` resolves, that is after the claim transaction has
committed.
This is the post-commit hand-off point of requirement 1. Without it, a handler that starts the build
starts it inside the claim.
The poller gains a second optional hook, `canClaim`, called before `claimNext`: when it returns false
the poller claims nothing and waits for its next tick.

How the six requirements of #105 are met:

| Requirement                             | Where                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. The hand-off is outside `claimNext`  | §2 steps 2 to 4                                                                    |
| 2. A lease renewed by a heartbeat       | §3                                                                                 |
| 3. Attempt-specific keys, fenced winner | §4 and §6                                                                          |
| 4. A cleanup path for every key         | §6                                                                                 |
| 5. The 24-hour retention                | §7                                                                                 |
| 6. The unchanged constraints            | §1 and §2 (the outbox only, no new role, `withTenant` only, the access re-checked) |

## 2. Flow

**Step 1 — the request (the API).**

`POST /v1/finance-reports/exports` validates the request and checks the limits of parent §7.4: one
running export per member, and at most N queued per clinic (`export_busy`).

In one `withTenant(clinicId)` transaction it:

- inserts the `finance_report_exports` row with `status = 'queued'` and `attempt = 0`,
- appends one `outbox_events` row: the type `finance.report_export_requested`, the clinic's
  `clinic_id`, and the payload `{ "exportId": "<id>" }` and nothing else.

The answer is `202` with the export id.

**Step 2 — the dispatcher claims the event.**

`OutboxPoller` calls `DispatcherOutbox.claimNext` (`packages/db/src/dispatcher.ts`) as
`eyadex_dispatcher`. The claim takes the oldest ready event of the type and runs the handler inside
the claim transaction, which has a 30 s `statement_timeout` and a 30 s
`idle_in_transaction_session_timeout`.

The handler builds nothing, uploads nothing and reads no report rows.

**Step 3 — the claim records the hand-off.**

The handler reads the export row inside `withTenant(clinicId)` on the app pool and takes the lease in
one short transaction of its own.
The claim role `eyadex_dispatcher` has no privilege on the export tables (§8), so the lease write is
never part of the claim transaction: it is its own transaction, and it commits on its own.

- `attempt = attempt + 1`,
- `lease_owner = <this worker>`,
- `lease_until = now + 60 s`,
- `status = 'running'`,
- `started_at` set once, on the first attempt.

The handler then returns `deferred` with `nextAttemptAt` = the end of the lease.
`deferred` is the dispatcher's own "not attempted yet" outcome: it does not count an attempt and it
does not touch `last_error`.

The event stays pending, so the outbox remains the only durable record of an unfinished export.

**Step 4 — after the commit, the runner takes the export.**

The `afterClaim` hook of §1 calls the runner's `wake()` once the claim has committed.

The runner keeps the ids it has leased in memory. On `wake()` it re-reads each of them, drops the
ones whose lease is not its own any more, and for the rest starts the heartbeat and puts the export
in the worker's local queue.

So the lease is in the database before anything is built, and the build never sits inside the claim
transaction.

`wake()` never blocks: it puts the id in the local queue and returns.
It never waits for a build slot, never awaits a build, and never does I/O on the claim path, so a
slow build can never hold a claim open.

**When the lease commits but the claim transaction rolls back.** The two writes are separate
transactions: the lease is on the app pool, and the claim's outcome is on the dispatcher pool.
A rollback of the claim leaves the event untouched, so it is claimed again, but the export row says
`running` with a live lease. Nothing is lost and nothing runs twice:

- the lease simply expires (60 s): no worker is building the export, so no heartbeat renews it,
- the attempt still counts: the `attempt` was incremented by the lease write and stays incremented,
- the next claim of the redelivered event finds `running` with an expired lease and takes it over
  (`attempt + 1`, the takeover of §5).

The mirror case — the lease transaction rolls back and the claim commits — leaves the row as it was
(`queued`), so the next claim takes the lease normally.

**Step 5 — the runner takes a slot and starts the build.**

A worker builds at most two exports at the same time (`EXPORT_CONCURRENCY`, default 2).
An export waiting for a slot keeps its lease, and its heartbeat keeps renewing it.

**The claim backpressure.** While N exports run locally (N = `EXPORT_CONCURRENCY`, default 2), the
export poller claims no new export event: its `canClaim` hook asks the runner, and while the
runner's local count is at N the poller claims nothing and waits for its next tick.
The event stays pending in the outbox, so nothing is lost and no export is skipped.
The local count is the number of exports the runner holds: the ones building and the ones waiting for
a slot.

**Step 6 — the access is re-checked.**

Before the runner reads a single report row it re-checks the access (parent §7.4): the requester's
membership and role now, the scope and the branch reach now, the report's own key, every extra key
the report needs, the module switch, and the clinic status.

The stored `scope` is an upper bound, never a grant.

A refused access ends the attempt as `forbidden`, and no further attempt is made: a retry would fail
the same way.

**Step 7 — the file is built.**

The report rows become a CSV or an XLSX (parent §7.1).

The CSV refusal (`export_amount_too_large`) ends the attempt as a final failure: no file is written.

For R5 to R8 the bytes are sealed before they leave the worker, like a medical attachment
(ADR-0028): the seal is bound to `finance_report_exports:blob:<clinic_id>:<export_id>:<attempt>`.

**Step 8 — the key is allocated, the row is written, then the bytes go up.**

The key is `clinic/<clinic_id>/finance-exports/<export_id>/<attempt>.<ext>`, where `ext` is `csv` or
`xlsx`.

Before the upload the runner writes the `finance_report_export_blobs` row with the state `allocated`,
in one short transaction: its own `id`, the export id and the attempt that allocates the key.
Then it uploads the bytes.

The row comes first on purpose: a crash between the row and the upload leaves a known key, and a
crash after the upload leaves a known key too.

**Step 9 — the fenced publish.**

One short transaction, on the app pool inside `withTenant(clinicId)`:

```sql
UPDATE finance_report_exports
   SET status = 'done', storage_key = $key, byte_size = $size, row_count = $rows,
       finished_at = $now, expires_at = $now + interval '24 hours', error_code = NULL,
       lease_owner = NULL, lease_until = NULL
 WHERE clinic_id = $clinic AND id = $export AND attempt = $mine AND lease_owner = $me
   AND lease_until > now()
```

The lease must still be alive: a lease that has expired is not the attempt's any more, so the attempt
publishes nothing.

The same transaction moves the blob row from `allocated` to `published`:

```sql
UPDATE finance_report_export_blobs
   SET state = 'published', updated_at = $now
 WHERE clinic_id = $clinic AND export_id = $export AND attempt = $mine AND state = 'allocated'
```

and it writes the audit row (`finance_report.exported`; a `patient_access` row for R5 to R8, as
parent §7.4 says).

Both statements must hit exactly one row: one export row and one blob row.
One row updated on each: the publish won.

No row updated on the export row, or no row updated on the blob row: the publish is refused.
The transaction aborts, so nothing it wrote is kept — not the status, not the blob state and not the
audit row — and the attempt deletes its own upload (step 10).

**Step 10 — a losing attempt cleans up after itself.**

A refused publish (step 9) means the worker no longer owns the row. It deletes its own upload, marks
its own blob row `deleted`, stops its heartbeat and exits.

It never touches the export row: the new owner owns it now.
Its own blob row is its own: the row of its own attempt, so it never touches the winner's blob row.

**The end of the flow.** The next claim of the event finds `status = 'done'` and returns `dispatched`,
which closes the event.

**What the handler decides on every claim.** The event is claimed again and again while the export is
unfinished, so the handler reads the export row and takes one branch:

| The row                                      | The handler                                                                                                 | What it writes on the export row                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `done`, `expired` or `purged`                | returns `dispatched`, and the event closes                                                                  | nothing                                                                                                            |
| `failed`                                     | returns `failed`, and the event closes                                                                      | nothing: the row already holds `status = 'failed'` and its `error_code`                                            |
| `running` with a live lease                  | returns `deferred` until the lease ends: another attempt owns it                                            | nothing                                                                                                            |
| `running` with an expired lease              | the takeover of §5: at the limit it fails the row, below the limit it takes the lease and starts an attempt | at the limit: `status = 'failed'`, `error_code = 'attempts_exhausted'`. Below the limit: the lease write of step 3 |
| `queued` and `next_attempt_at` in the future | returns `deferred` until that time                                                                          | nothing                                                                                                            |
| `queued` and due                             | takes the lease (`attempt + 1`) and starts an attempt                                                       | the lease write of step 3                                                                                          |
| `queued` and `attempt` at the limit          | returns `failed`                                                                                            | `status = 'failed'`, `error_code = 'attempts_exhausted'`                                                           |
| no row at all                                | returns `failed`: the export was never written, or the clinic is gone                                       | nothing: there is no row to write                                                                                  |

The lease write of step 3 is `attempt + 1`, `lease_owner`, `lease_until = now + 60 s`,
`status = 'running'` and `started_at` set once on the first attempt.
The limit is 5 attempts (§5): a new attempt needs `attempt < 5`, and `attempt` never goes above 5.

A malformed payload returns `failed` with `invalid_payload`, as the other handlers do.
It writes nothing on the export row: the handler never read it.

The lease is taken in the same short transaction as the read, so two workers cannot both take it: the
row lock decides, and the loser sees a live lease and defers.

## 3. Lease and heartbeat

- The lease lives on the export row: `lease_owner text` and `lease_until timestamptz`.
- `lease_owner` is a per-process id (host, pid and a UUID generated at boot). It is not a secret and
  it is not a user id.
- The lease is taken when the hand-off is recorded and it is released when the attempt ends, whatever
  the outcome.
- The lease lasts 60 s. The heartbeat runs every 20 s, so two missed beats still leave 20 s of lease.
- The heartbeat is one short `withTenant` transaction:

```sql
UPDATE finance_report_exports SET lease_until = $now + interval '60 seconds'
 WHERE clinic_id = $clinic AND id = $export AND attempt = $mine AND lease_owner = $me
```

- The heartbeat carries the fence of §4: `attempt = $mine AND lease_owner = $me`.
  Every write an attempt makes to the export row carries it: the heartbeat, the publish, the
  failure, the release and the abandon.
- Zero rows updated means the lease is gone: the attempt was taken over. The runner stops the build,
  deletes its own upload, marks its blob row `deleted` and exits.
- The heartbeat covers the whole attempt: the wait for a free build slot and the build itself.
  A busy worker never looks dead, and a live build is never taken over.
- The heartbeat stops when the attempt ends.
- No transaction holds a lock across the network: the lease, the heartbeat, the blob row and the
  publish are each their own short transaction, and the upload happens between them.

## 4. Attempts, fencing and publish

- `attempt` counts the attempts of one export. It starts at 0, and every hand-off increments it.
- The attempt number is part of the blob key, so two attempts never write to the same key.
- **The fence is on every write an attempt makes to the export row.** The heartbeat, the publish, the
  failure, the release and the abandon all carry
  `WHERE clinic_id = $clinic AND id = $export AND attempt = $mine AND lease_owner = $me`.
  A write that updates 0 rows is a lost race: the attempt stops, deletes its own upload and exits.
  The lease write of step 3 is not one of them: it takes the lease, so it is fenced on the row's
  current `attempt` and on the lease being free.
- The publish is fenced on `(id, attempt, lease_owner)` and on a live lease (`lease_until > now()`,
  §2 step 9). The fence is the only thing that decides the winner.
- A stale attempt (its lease was taken over, or its heartbeat failed) updates 0 rows: it is fenced
  out.
- A stale attempt deletes its own upload, and only its own key. The published key belongs to the
  winner and is never touched by a loser.
- The winner's attempt is the row's `attempt` after the publish, because the fence requires
  `attempt = $mine`. So the download can unseal the bytes with the right additional data.
- The publish is idempotent by export id: a second publish of the same attempt changes 0 rows,
  because the first one cleared `lease_owner`.

## 5. Failure and retry

The failure kinds and whether they retry:

| Kind                      | Final? | Why                                                       |
| ------------------------- | ------ | --------------------------------------------------------- |
| `forbidden`               | yes    | the access re-check refused; a retry fails the same       |
| `export_amount_too_large` | yes    | the data is what it is (parent §7.1)                      |
| `build_failed`            | no     | the exporter threw                                        |
| `store_unavailable`       | no     | the blob store answered 5xx or was unreachable            |
| `db_error`                | no     | the database failed                                       |
| `lease_lost`              | no     | the attempt was taken over; the new owner retries         |
| `attempts_exhausted`      | yes    | the attempt limit was reached; no further attempt is made |

- At most 5 attempts: `attempt` never goes above 5, and a new attempt needs `attempt < 5`.
  The fifth failed attempt sets `status = 'failed'` and no further attempt is made.
- **The attempt limit is checked before every new attempt**, not only after a failure:
  - the takeover of an expired lease at the limit writes `status = 'failed'` and
    `error_code = 'attempts_exhausted'`, and the handler returns `failed`,
  - a `queued` row at the limit writes the same two columns, and the handler returns `failed`,
  - a fifth attempt that ends in an abandon (§9) goes back to `queued`, and its next claim writes
    `status = 'failed'` and `error_code = 'attempts_exhausted'`.
- The backoff between attempts: 1 minute, 5 minutes, 30 minutes, 2 hours.
  It is the same ladder as `apps/worker/src/invitation-mail/domain/retry-schedule.ts` (`afterFailure`),
  which the patient-notification handler already reuses.
- The backoff is written on the export row as `next_attempt_at`, and the row goes back to
  `status = 'queued'`.
  The next claim of the event finds `queued` with `next_attempt_at` in the future and defers until
  then.
- A failed attempt releases the lease (`lease_owner = NULL`, `lease_until = NULL`), so a dead worker
  never holds a row.
  The failure write and the release write both carry the fence of §4: a write that updates 0 rows
  means the attempt was taken over, so it writes nothing, deletes its own upload and exits.
- A final failure sets `status = 'failed'` and the `error_code`. The row stays for the audit trail
  and is never deleted. The next claim of the event returns `failed`, which closes the event.
- The takeover of an expired lease: the next claim of the event finds `status = 'running'` with
  `lease_until` in the past, so the worker is presumed dead. It checks the attempt limit first: at
  the limit it writes `status = 'failed'` and `error_code = 'attempts_exhausted'` and takes no lease.
  Below the limit it takes the lease (`attempt + 1`, its own owner) and starts a new attempt.
  The old worker, if it comes back, is fenced out at its publish (§4) and deletes its own upload.
- A takeover counts as an attempt: five takeovers without a publish end as `failed`.

## 6. Blob keys and cleanup

The key layout:

```
clinic/<clinic_id>/finance-exports/<export_id>/<attempt>.<ext>
```

- The key holds ids and the attempt only: no patient name, no file name, no report content (the
  0049 rule).
- Each attempt has its own key, so a published file and a losing upload never share a key.

The blob table is `finance_report_export_blobs`: one row per key ever allocated, written **before**
the upload.

| Column        | Type          | Null     | Meaning                                       |
| ------------- | ------------- | -------- | --------------------------------------------- |
| `clinic_id`   | `uuid`        | NOT NULL | the clinic                                    |
| `id`          | `uuid`        | NOT NULL | the row's own id (a UUID v7), the primary key |
| `export_id`   | `uuid`        | NOT NULL | the export                                    |
| `attempt`     | `integer`     | NOT NULL | the attempt that allocated the key            |
| `storage_key` | `text`        | NOT NULL | the key                                       |
| `state`       | `text`        | NOT NULL | `allocated` / `published` / `deleted`         |
| `created_at`  | `timestamptz` | NOT NULL | when the key was allocated                    |
| `updated_at`  | `timestamptz` | NOT NULL | when the state last changed                   |

The primary key is `(clinic_id, id)` (CLAUDE.md §5), and `(clinic_id, export_id, attempt)` is unique:
one row per key ever allocated (§8.2).

- `allocated` — the key is reserved. The upload may be running, partial or missing.
- `published` — the fenced publish won, and this key is the file the download serves.
- `deleted` — the bytes are gone.

The sweeper is a periodic job (`EXPORT_SWEEP_INTERVAL_MS`).
It deletes a key only when it is sure that no live attempt still needs it.
It reads the export row of every candidate inside `withTenant(clinicId)`, so it knows the row's
current `attempt` and its lease before it deletes anything.

- an `allocated` row whose `attempt` is **below the export row's current `attempt`** is deleted and set
  to `deleted`: that attempt lost the race, its upload is not the published file, and it can never
  be published any more,
- an `allocated` row whose `created_at` is **older than the build budget plus the lease**
  (15 min + 60 s) is deleted and set to `deleted`: its attempt is past the budget of §9 and its lease
  is long gone, so nothing is uploading under that key any more,
- an `allocated` row of the export's **current** attempt is never deleted while the export is
  `running` with a live lease: the upload may be in flight and the publish still needs the key,
- every `published` row whose export's `expires_at` has passed is deleted and set to `deleted`, and
  its export becomes `expired` (§7),
- a key that is not there is not an error: the sweep is idempotent, and a second run deletes nothing.

The order is always the same: the bytes first, then the row state.
A crash between the two leaves a row that claims a key which is already gone; the next sweep deletes
the missing key and marks the row.

The sweeper never lists the bucket. It reads the keys from the table and deletes them one by one.

The sweeper finds its work the way the expiry-reminder scan does: the platform pool lists the clinics,
and each clinic's rows are read and written inside `withTenant(clinicId)` on the app pool.
So the export tables are never read across clinics, and `eyadex_platform` keeps no privilege on them.
Each run takes a bounded batch per clinic (50 rows), and the rest waits for the next run.

The blob store port:

- The port today (`apps/api/src/shared/blob/blob-store.ts`) has `put` and `get` only, and the MinIO
  policy has no `s3:DeleteObject`.
- The pipeline needs a third operation, `delete(key)`: the bytes of a losing attempt, an expired file
  and a refused `own` export are deleted.
- A missing object is not an error (a delete is idempotent). A 5xx or an unreachable store is an
  error, and the sweep is retried at the next run.
- What is missing today, on the code and on the storage side, is a prerequisite of slice 4 and is
  listed in §11.

## 7. Retention, expiry and purge

- The published file lives 24 hours (F3-Q10 a): `expires_at = published_at + 24 hours`, set by the
  publish.
- At `expires_at` the sweeper deletes the key, sets the blob row `deleted`, sets the export
  `expired`, clears `storage_key` and clears `patient_ids`, so no patient id outlives the file
  (EY-10.4).
  The `patient_ids` are cleared **when the row expires**, and on every row whose `expires_at` has
  passed: a `done` row becomes `expired`, and a `purged` row stays `purged` and only loses its
  `patient_ids`.
- The export row itself is never deleted (parent §7.4, CLAUDE.md §5).
- The `own` purge of EY-10.4: when a download is refused because a patient left the requester's
  reach, the file is purged at once.
  The API deletes the key, sets the blob row `deleted`, and sets the export `purged` with
  `storage_key = NULL`.
  The purge does **not** clear `patient_ids`: they are cleared when the row expires, as parent §7.4
  says (EY-10.4).
  The row stays for the audit trail, and the requester must ask for a new export.
  The order is the same as the sweep: the bytes first, then the row.
- A download of a file whose row is `expired` or `purged` answers `not_found`: there is no file to
  serve.
- The expiry and the purge write no audit row: the export's audit row was written once, by the
  winning attempt at the publish.

## 8. Tables (columns for slice 2's SQL)

### 8.1 `finance_report_exports`

The table of parent §7.3, with the attempt and lease columns this pipeline adds.

| Column            | Type          | Null     | Default    | Note                                                            |
| ----------------- | ------------- | -------- | ---------- | --------------------------------------------------------------- |
| `clinic_id`       | `uuid`        | NOT NULL | —          | the clinic                                                      |
| `id`              | `uuid`        | NOT NULL | —          | a UUID v7 from the application                                  |
| `requested_by`    | `uuid`        | NOT NULL | —          | a membership id, no FK (like `payments.received_by`)            |
| `report`          | `text`        | NOT NULL | —          | the report key of parent §4                                     |
| `params`          | `jsonb`       | NOT NULL | —          | the range, the branch ids, the language; no patient field       |
| `format`          | `text`        | NOT NULL | —          | `csv` / `xlsx`                                                  |
| `scope`           | `text`        | NOT NULL | —          | `clinic` / `branch` / `own`                                     |
| `patient_ids`     | `uuid[]`      | NULL     | —          | the patients of an `own` export                                 |
| `status`          | `text`        | NOT NULL | `'queued'` | `queued` / `running` / `done` / `failed` / `expired` / `purged` |
| `attempt`         | `integer`     | NOT NULL | `0`        | the attempts so far                                             |
| `lease_owner`     | `text`        | NULL     | —          | the worker that holds the lease                                 |
| `lease_until`     | `timestamptz` | NULL     | —          | when the lease ends                                             |
| `next_attempt_at` | `timestamptz` | NULL     | —          | the earliest time of the next attempt                           |
| `storage_key`     | `text`        | NULL     | —          | the published key                                               |
| `byte_size`       | `integer`     | NULL     | —          | the stored bytes                                                |
| `row_count`       | `integer`     | NULL     | —          | the data rows in the file                                       |
| `error_code`      | `text`        | NULL     | —          | the failure kind, never a message                               |
| `created_at`      | `timestamptz` | NOT NULL | —          |                                                                 |
| `started_at`      | `timestamptz` | NULL     | —          | set on the first attempt                                        |
| `finished_at`     | `timestamptz` | NULL     | —          | set when the attempt ends                                       |
| `expires_at`      | `timestamptz` | NULL     | —          | the publish time plus 24 hours                                  |

Checks:

- `report` in the ten report keys of parent §4,
- `format` in (`csv`, `xlsx`),
- `scope` in (`clinic`, `branch`, `own`),
- `status` in (`queued`, `running`, `done`, `failed`, `expired`, `purged`),
- `attempt >= 0`,
- `byte_size` is null or above 0,
- `row_count` is null or not below 0,
- `storage_key` is null, or matches
  `^clinic/[0-9a-f-]{36}/finance-exports/[0-9a-f-]{36}/[0-9]+\.(csv|xlsx)$`.

Primary key `(clinic_id, id)`.

Indexes:

- `(clinic_id, requested_by, created_at)` — the requester's export list (parent §7.3).
- `(clinic_id, status, expires_at)` — the expiry sweep of §7.
  This is not a queue index: the worker still reaches a job by its id, through its outbox event.

RLS, the standard of every clinic table (CLAUDE.md §5):

```sql
ALTER TABLE finance_report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_report_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_report_exports_tenant_isolation ON finance_report_exports
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
```

Grants:

```sql
GRANT SELECT, INSERT ON finance_report_exports TO eyadex_app;
GRANT UPDATE (status, attempt, lease_owner, lease_until, next_attempt_at, storage_key, byte_size,
              row_count, error_code, started_at, finished_at, expires_at, patient_ids)
  ON finance_report_exports TO eyadex_app;
REVOKE ALL ON finance_report_exports FROM eyadex_platform, eyadex_auth, eyadex_dispatcher;
```

There is no `DELETE`: the row is never deleted.

### 8.2 `finance_report_export_blobs`

| Column        | Type          | Null     | Default | Note                                  |
| ------------- | ------------- | -------- | ------- | ------------------------------------- |
| `clinic_id`   | `uuid`        | NOT NULL | —       | the clinic                            |
| `id`          | `uuid`        | NOT NULL | —       | a UUID v7 from the application        |
| `export_id`   | `uuid`        | NOT NULL | —       | the export                            |
| `attempt`     | `integer`     | NOT NULL | —       | the attempt that allocated the key    |
| `storage_key` | `text`        | NOT NULL | —       | the key                               |
| `state`       | `text`        | NOT NULL | —       | `allocated` / `published` / `deleted` |
| `created_at`  | `timestamptz` | NOT NULL | —       |                                       |
| `updated_at`  | `timestamptz` | NOT NULL | —       |                                       |

Primary key `(clinic_id, id)`, the standard of every clinic table (CLAUDE.md §5).
The row has an id of its own, like every other clinic table, and not only the key of its attempt.

Unique `(clinic_id, export_id, attempt)`: one row per key ever allocated.

Foreign key `(clinic_id, export_id)` to `finance_report_exports (clinic_id, id)`.
The unique constraint leads with the foreign key's columns, so `db/tests/fk-indexes.sql` is
satisfied.

Checks:

- `attempt >= 1`,
- `state` in (`allocated`, `published`, `deleted`),
- `storage_key` matches
  `^clinic/[0-9a-f-]{36}/finance-exports/[0-9a-f-]{36}/[0-9]+\.(csv|xlsx)$`.

Index `(clinic_id, state, updated_at)` — the sweep of §6.

RLS: the same standard policy as §8.1, with its own name.

Grants:

```sql
GRANT SELECT, INSERT ON finance_report_export_blobs TO eyadex_app;
GRANT UPDATE (state, updated_at) ON finance_report_export_blobs TO eyadex_app;
REVOKE ALL ON finance_report_export_blobs FROM eyadex_platform, eyadex_auth, eyadex_dispatcher;
```

The `UPDATE` is column level, like the export table of §8.1: a blob row only ever moves from
`allocated` to `published` or to `deleted`, and nothing else about it changes.

There is no `DELETE`: the rows are the trail of every key ever allocated.

### 8.3 What slice 2's SQL does with this

- The file that creates `finance_report_exports` (parent §8, `0068_finance_reports_core.sql`) also
  creates `finance_report_export_blobs`, both with their policies, indexes and grants.
- Both tables join the negative isolation test of `db/tests/rls-isolation.sql`: the seed loop, the
  read-leak array, the write-leak `INSERT` block and the move-row `UPDATE` array.
- `db/tests/finance-reports-platform.sql` (new, parent §8) proves that `eyadex_platform`,
  `eyadex_auth` and `eyadex_dispatcher` have no privilege on either table.
- The Drizzle mirror in `packages/db/src/schema` is added with the file (ADR-0024), and
  `schema-drift.db.spec.ts` stays the comparator.

## 9. Timeouts

| What                              | Value                | Where                                               |
| --------------------------------- | -------------------- | --------------------------------------------------- |
| the claim's transaction           | 30 s                 | unchanged (`packages/db/src/dispatcher.ts`)         |
| the lease                         | 60 s                 | `lease_until`                                       |
| the heartbeat                     | 20 s                 | the runner's timer                                  |
| one build's own budget            | 15 min               | the runner abandons the attempt                     |
| the sweep                         | 5 min                | the periodic job                                    |
| the builds per worker             | 2                    | the runner's local queue and the claim backpressure |
| the next look at a running export | the end of its lease | the event's `next_attempt_at`                       |

- The 30 s claim timeout is untouched. The claim transaction holds the outbox row only: the lease
  write is its own short transaction on the app pool, because the claim role has no privilege on the
  export tables (§8).
  The report queries, the build and the upload all happen after the claim has committed, in their own
  transactions.
- The build's budget: an attempt that runs past 15 minutes is abandoned. Its lease is released, its
  upload, if any, is deleted, and the row goes back to `queued` with the backoff of §5.
  The release and the abandon carry the fence of §4: a write that updates 0 rows means the attempt
  was taken over, so it writes nothing, deletes its own upload and exits.
  A fifth attempt that is abandoned leaves the row `queued` at the limit, and its next claim writes
  `status = 'failed'` and `error_code = 'attempts_exhausted'` (§5).

## 10. Tests

The export slice must have these tests.

Unit (the domain):

- the key layout: `clinic/<clinic>/finance-exports/<export>/<attempt>.<ext>`, and the extension
  follows the format,
- the backoff ladder: 1, 5, 30 and 120 minutes, and the fifth attempt is final,
- the failure kinds: `forbidden`, `export_amount_too_large` and `attempts_exhausted` are final, the
  others retry,
- the heartbeat's decision: the runner stops when the renewal updates 0 rows.

Integration (against PostgreSQL, as `eyadex_app`):

- the hand-off: the request writes the export row and the outbox event in one transaction, and a
  rolled-back request writes neither,
- the claim records the hand-off only: after the claim the row is `running` with a lease and an
  incremented attempt, and no file exists,
- the lease takeover: a row `running` with an expired lease is taken over by the next claim, with
  `attempt + 1` and a new owner,
- the fenced publish: a publish with a stale attempt or a stale owner updates 0 rows and the export
  row is unchanged,
- the live lease at the publish: a publish whose `lease_until` is in the past updates 0 rows, the blob
  row stays `allocated` and the audit row is not written,
- the publish moves the blob row: the blob row goes from `allocated` to `published` in the same
  transaction, and a blob row that is not `allocated` aborts the whole publish, so the export row and
  the audit row stay as they were,
- the attempt limit: a `running` row with an expired lease at the limit becomes `failed` with
  `attempts_exhausted`, and so does a `queued` row at the limit,
- the sweeper never touches a live upload: the `allocated` row of the current attempt of a running
  export with a live lease is not deleted,
- the sweeper deletes the losers: the `allocated` row of an attempt below the row's current `attempt`
  is deleted, and so is an `allocated` row older than the build budget plus the lease,
- the stale upload is deleted: the losing attempt's key is gone and its blob row is `deleted`,
- the published file: the publish sets `status`, `storage_key`, `byte_size`, `row_count` and
  `expires_at` (24 hours), and the blob row is `published`,
- the blob row is written before the upload: a failed upload leaves an `allocated` row,
- the sweeper: an `allocated` row of a dead attempt is deleted (an attempt below the row's current
  `attempt`, or one older than the build budget plus the lease), an expired `published` row is
  deleted and its export becomes `expired`, and a second run deletes nothing,
- the retention: at `expires_at` the key is gone, the row is `expired`, and `storage_key` and
  `patient_ids` are null,
- the purge: a refused `own` download deletes the key, sets `purged` and clears `storage_key`, and the
  row keeps its `patient_ids`,
- the retry: a failed attempt goes back to `queued` with `next_attempt_at`, a claim before that time
  defers, and the fifth failure sets `failed`,
- the access re-check: a requester who lost the key gets `forbidden` and no file is uploaded,
- the audit row: the publish writes exactly one `finance_report.exported` row, and for R5 to R8 it is
  a `patient_access` row with no name and no reason in it,
- the RLS negative tests of both tables: a cross-clinic read returns 0 rows and a cross-clinic write
  is an error.

The blob store is a test double in these tests: an in-memory store that records the keys it holds and
the deletes it saw. No test calls a server, and no test reads a real key from an `.env` file.

## 11. Prerequisites

The pipeline needs a blob deletion that the platform does not have today.
Nothing in slices 1 to 3 depends on it: they carry no file and delete no key.
Slice 4 (the exports) cannot ship without it, because the cleanup of every key ever allocated is a
binding requirement (requirement 4).

**The port has no `delete`.** The `BlobStore` port (`apps/api/src/shared/blob/blob-store.ts`) has
`put` and `get` only, and the worker has no blob store at all.
The pipeline needs a third operation, `delete(key)` on both adapters:

- the API adapter (`S3BlobStore` and `MemoryBlobStore`) deletes the key of a refused `own` export
  (EY-10.4),
- the worker's adapter deletes the key of a losing attempt, of an expired file and of an orphaned
  upload.

The worker gets its own port and S3 client under `apps/worker/src/shared/blob/`, with the same
contract, because the apps never import each other.
If the reviewer prefers one implementation, the port moves to a shared package in a separate change
that also updates `CLAUDE.architecture.md` §2.
The worker also gets the `MEDICAL_BLOB_S3_*` variables: the same private bucket, on the internal
network.

**The storage policy grants no `s3:DeleteObject`.** The bucket policy allows `s3:PutObject` and
`s3:GetObject` only.
The worker's storage user needs `s3:DeleteObject` on the `clinic/*/finance-exports/*` prefix, and
the API's user needs it on the same prefix for the purge.
The attachments' keys stay undeletable: the export prefix is the only one that gets the permission.

**Both are a server change, and the owner says yes before slice 4 ships.** The grant lives on the
storage side (the bucket policy and the worker's storage user), not in the code, so it is prepared
and applied with the owner's own yes, like the production SQL of parent §8.
Until it is in place, the export slice does not ship: a stale key could never be cleaned up.
