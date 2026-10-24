# Finance F3 — the export pipeline (design)

- Status: **decided** (2026-10-23). This is the design issue #105 asked for. Nothing here is built.
- Review: the two Codex P2 findings of PR #121 are folded in — the publish whose answer was lost
  (§2 step 9, §3, §4) and the upload that lands after its key was swept (§2 step 8, §6, §8.2, §10).
  The last round of the same review adds three more: the `own` export's patient set and the publish
  that writes it (§2 step 7, §2 step 9, §8.1, §10), the heartbeat that can no longer revive a lease
  (§3, §4, §9, §10), and the key that is never final at its first delete (§6, §7, §8.2, §9, §10).
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
- the blob deletion itself: the `delete` and `exists` on the port, the `s3:DeleteObject` grant and
  the bucket's lifecycle rule for export objects are a server change that lands before slice 4 and
  that slices 1 to 3 never need (§11).

Where the code goes (parent slice 4): `apps/worker/src/finance-exports/`.

| File                               | What it holds                                                     |
| ---------------------------------- | ----------------------------------------------------------------- |
| `handle-export-requested.ts`       | the claim handler: the hand-off only, no build                    |
| `export-runner.ts`                 | the local queue, the heartbeat and the build                      |
| `persistence/pg-export-store.ts`   | the lease, the heartbeat, the blob rows and the publish           |
| `persistence/pg-export-sweeper.ts` | the expiry sweep and the cleanup of every allocated key           |
| `domain/export-key.ts`             | the blob key layout                                               |
| `domain/export-failures.ts`        | the failure kinds and the backoff ladder                          |
| `ports/blob-store.ts`              | the worker's blob port: `put` (tagged), `get`, `delete`, `exists` |

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
- `lease_until = clock_timestamp() + 60 s`,
- `status = 'running'`,
- `started_at` set once, on the first attempt.

**One running export per member, held by the database.** The request's check of step 1 sees only the
moment of the request: two requests from one member can both pass it before either is leased. So the
lease also runs into the partial unique index `(clinic_id, requested_by) WHERE status = 'running'`
(§8.1). A lease write that would make a second `running` row for the member fails on that index; the
transaction rolls back, nothing is written, and the handler returns `deferred` with `nextAttemptAt`
30 s later. A takeover of the member's own expired lease updates the same row, so it never trips the
index. The block cannot outlive the stuck row: a `running` row with an expired lease still has its
own pending event, and its next claim takes it over or fails it at the attempt limit (§5). So a
member's queued export waits at most one lease plus the claim interval behind a dead attempt.

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

The build also collects the **patient set**: the patient ids of every row it wrote. For a
patient-named report it is the patient of each row, for an aggregate report the patients behind the
rows it aggregated. The set is kept in memory and the publish writes it (step 9); nothing else
writes it.

The CSV refusal (`export_amount_too_large`) ends the attempt as a final failure: no file is written.

For R5 to R8 the bytes are sealed before they leave the worker, like a medical attachment
(ADR-0028): the seal is bound to `finance_report_exports:blob:<clinic_id>:<export_id>:<attempt>`.

**Step 8 — the key is allocated, the row is written, then the bytes go up.**

The key is `clinic/<clinic_id>/finance-exports/<export_id>/<attempt>.<ext>`, where `ext` is `csv` or
`xlsx`.

Before the upload the runner writes the `finance_report_export_blobs` row with the state `allocated`,
in one short transaction: its own `id`, the export id and the attempt that allocates the key.
Then it re-checks and uploads the bytes.

The row comes first on purpose: a crash between the row and the upload leaves a known key, and a
crash after the upload leaves a known key too.

**The re-check before the upload.** The sweeper may have swept this key while the build was
running (§6), so the attempt re-checks before it uploads, in one short `withTenant` transaction:
the export row under the fence of §4 and the live lease of step 9, and its own blob row.

- the export row is no longer the attempt's: the attempt stops before it uploads. There is nothing
  it may publish, and a late upload would be an orphan,
- its blob row is not `allocated` any more (the sweeper deleted it, §6): the attempt stops too. The
  key is gone, so an upload would be an orphan the cleanup never sees, because the sweeper never
  lists the bucket.

**The upload and the `uploaded` state.** The attempt uploads the bytes and then moves its own blob
row from `allocated` to `uploaded`, in one short transaction fenced on the row:

```sql
UPDATE finance_report_export_blobs
   SET state = 'uploaded', updated_at = now()
 WHERE clinic_id = $clinic AND export_id = $export AND attempt = $mine AND state = 'allocated'
```

If that update hits 0 rows, the row is not `allocated` any more: the sweeper deleted it while the
bytes were going up. The attempt deletes what it just uploaded, so no orphan is left behind, and it
stops: the publish of step 9 needs the blob row to be `uploaded`. Only the sweeper can have moved
that row by now — the publish's own move comes later and needs `uploaded` — so no winner's file is
at stake here.

The `uploaded` state says the bytes are in the store and that the row is still the attempt's. It
exists for the race only, and the sweeper reads it like `allocated` (§6).

**Step 9 — the fenced publish.**

One short transaction, on the app pool inside `withTenant(clinicId)`:

```sql
UPDATE finance_report_exports
   SET status = 'done', storage_key = $key, byte_size = $size, row_count = $rows,
       patient_ids = $patients,
       finished_at = clock_timestamp(), expires_at = clock_timestamp() + interval '24 hours',
       error_code = NULL,
       lease_owner = NULL, lease_until = NULL
 WHERE clinic_id = $clinic AND id = $export AND attempt = $mine AND lease_owner = $me
   AND lease_until > clock_timestamp()
```

The lease must still be alive: a lease that has expired is not the attempt's any more, so the attempt
publishes nothing.

The blob row's update below runs **first** in the transaction, and this export update runs last, so a
wait on the blob row cannot push the commit past the stored times. `finished_at` and `expires_at` are
then read from `clock_timestamp()` rather than the transaction's start (`now()`), so the 24 hours
start at the publication itself. The fence reads the same clock (`lease_until > clock_timestamp()`),
so a lease that expires while the transaction waits on the blob row refuses the publish (§3, one
clock).
A final row (`done`, `failed`, `expired`, `purged`) holds no live lease — the publish and the release
clear it — so the publish never touches one either.

`$patients` is the patient set the build collected (step 7): the ids of an `own` export, and NULL for
every other scope. The publish writes it in the same UPDATE that sets `done`, so a published `own`
export always carries the patients of its file, and an export of another scope keeps `patient_ids`
NULL.

**The `own` patient set.** The download re-checks the reach on those ids (parent §7.4), so a
download of an `own` export whose `patient_ids` is NULL is **refused**: the re-check has no patient
set to run the predicate on, and the file is not served. The publish is the only writer of the
column, so a NULL patient set on a published `own` export is a fault, and the download fails closed
on it.

The same transaction moves the blob row from `uploaded` to `published`:

```sql
UPDATE finance_report_export_blobs
   SET state = 'published', updated_at = now()
 WHERE clinic_id = $clinic AND export_id = $export AND attempt = $mine AND state = 'uploaded'
```

and it writes the audit row (`finance_report.exported`; a `patient_access` row for R5 to R8, as
parent §7.4 says).

Both statements must hit exactly one row: one export row and one blob row.
One row updated on each: the publish won.

No row updated on the export row, or no row updated on the blob row: the publish is refused.
The transaction aborts, so nothing it wrote is kept — not the status, not the blob state and not the
audit row. The attempt deletes nothing on that answer: it re-reads first (the rule below).

**The publish whose answer was lost.** A commit that succeeded but whose answer never came back is
not a lost publish: the transaction is durable, only the answer is gone. So a publish that updates
0 rows is not refused straight away. The attempt re-reads the export row and its own blob row, in
one short `withTenant` transaction, and reads the state:

- the export row is `done`, its `storage_key` is this attempt's key and the blob row is `published`:
  the publish committed and the answer was lost. This is the attempt's own success: it keeps the
  file, it stops the heartbeat and it exits, and it deletes nothing,
- anything else: another attempt, or another state, holds the row. The upload is deleted (step 10).

The key carries the attempt number, so a key that equals this attempt's key is this attempt's file
and no other attempt's.

The re-read is asked in two places, and the answer is the same in both: after a publish that
updated 0 rows (this step) and after a heartbeat that updated 0 rows (§3).

**Step 10 — a losing attempt cleans up after itself.**

A refused publish (step 9) means the worker no longer owns the row. It deletes its own upload, marks
its own blob row `deleted` with its `deleted_at`, stops its heartbeat and exits.

It never touches the export row: the new owner owns it now.
Its own blob row is its own: the row of its own attempt, so it never touches the winner's blob row.
It marks the row `deleted` only while the row is still `allocated` or `uploaded`: a blob row the
sweeper already marked `deleted` or `gone` stays as it is (§6).

A publish that was refused but whose re-read showed the attempt's own success (step 9) is not a
losing attempt: it keeps its file, it deletes nothing and it exits.

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

The lease write of step 3 is `attempt + 1`, `lease_owner`, `lease_until = clock_timestamp() + 60 s`,
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
UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '60 seconds'
 WHERE clinic_id = $clinic AND id = $export AND attempt = $mine AND lease_owner = $me
   AND status = 'running' AND lease_until > clock_timestamp()
```

- **One clock.** Every lease timestamp and every lease check reads the database's current time,
  `clock_timestamp()`: the lease write, the heartbeat, the publish (its fence and its `finished_at`
  and `expires_at`) and the sweep's age checks. A lease is written and checked on the same clock, so
  a skewed worker clock can neither shorten a live lease nor stretch an expired one. It is not
  `now()`, the transaction's start: a statement that waits on a row lock would otherwise check an
  expired lease against an older time and pass. The worker's own clock times only its local timers
  (the heartbeat interval and the build budget).
- The heartbeat carries the fence of §4: `attempt = $mine AND lease_owner = $me`.
  Every write an attempt makes to the export row carries it: the heartbeat, the publish, the
  failure, the release and the abandon.
- The heartbeat adds two conditions of its own: `status = 'running'` and `lease_until > clock_timestamp()`.
  **A heartbeat never revives a lease and never touches a final row.** An expired lease is not the
  attempt's any more — the takeover of §5 owns the row now — so the heartbeat does not extend it,
  and a final row (`done`, `failed`, `expired`, `purged`) is never renewed either.
- Zero rows updated means the attempt's lease is no longer live. The runner deletes nothing on that
  answer: it re-reads the export row and its own blob row first (§4, the re-read of §2 step 9). If
  the export row is `done` with this attempt's key in `storage_key` and the blob row is `published`,
  the attempt is its own success — it keeps the file, it stops the heartbeat and it exits.
  Otherwise the lease is gone: the runner stops the build, deletes its own upload, marks its blob row
  `deleted` and exits.
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
  The heartbeat adds `status = 'running' AND lease_until > clock_timestamp()` on top of them (§3).
  A write that updates 0 rows is a lost race, and the attempt re-reads before it deletes anything:
  the re-read of §2 step 9 asks whether this attempt's own publish is the row's `done` state. If it
  is, the attempt keeps its file and exits; otherwise it stops, deletes its own upload and exits.
  The lease write of step 3 is not one of them: it takes the lease, so it is fenced on the row's
  current `attempt` and on the lease being free.
- The blob row writes carry the attempt's own row, `(clinic_id, export_id, attempt = $mine)`: the
  `allocated` to `uploaded` move of step 8 and the `uploaded` to `published` move of step 9 touch
  the attempt's own row and no other, so a loser never moves the winner's blob row.
- The publish is fenced on `(id, attempt, lease_owner)` and on a live lease (`lease_until > clock_timestamp()`,
  §2 step 9). The fence is the only thing that decides the winner.
- A stale attempt (its lease was taken over, or its heartbeat failed) updates 0 rows: it is fenced
  out.
- A stale attempt deletes its own upload, and only its own key, after the re-read above. The published
  key belongs to the winner and is never touched by a loser.
- The winner's attempt is the row's `attempt` after the publish, because the fence requires
  `attempt = $mine`. So the download can unseal the bytes with the right additional data.
- The publish is idempotent by export id: a second publish of the same attempt changes 0 rows,
  because the first one cleared `lease_owner`. The re-read of §2 step 9 then finds the attempt's own
  success, so the retry keeps the file and deletes nothing.

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
  means the attempt was taken over, so it writes nothing. The attempt re-reads first (§4): if the
  re-read shows the attempt's own published file, it keeps the file and exits; otherwise it deletes
  its own upload and exits.
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

| Column        | Type          | Null     | Meaning                                                     |
| ------------- | ------------- | -------- | ----------------------------------------------------------- |
| `clinic_id`   | `uuid`        | NOT NULL | the clinic                                                  |
| `id`          | `uuid`        | NOT NULL | the row's own id (a UUID v7), the primary key               |
| `export_id`   | `uuid`        | NOT NULL | the export                                                  |
| `attempt`     | `integer`     | NOT NULL | the attempt that allocated the key                          |
| `storage_key` | `text`        | NOT NULL | the key                                                     |
| `state`       | `text`        | NOT NULL | `allocated` / `uploaded` / `published` / `deleted` / `gone` |
| `deleted_at`  | `timestamptz` | NULL     | when the bytes were deleted                                 |
| `created_at`  | `timestamptz` | NOT NULL | when the key was allocated                                  |
| `updated_at`  | `timestamptz` | NOT NULL | when the state last changed                                 |

The primary key is `(clinic_id, id)` (CLAUDE.md §5), and `(clinic_id, export_id, attempt)` is unique:
one row per key ever allocated (§8.2).

- `allocated` — the key is reserved. The upload may be running, partial or missing.
- `uploaded` — the bytes are in the store under this key, and the row is still the attempt's.
- `published` — the fenced publish won, and this key is the file the download serves.
- `deleted` — the bytes were deleted, and the row carries its `deleted_at`. The row is not final yet:
  a PUT that was still in flight can land after the delete.
- `gone` — the key was deleted a second time after the grace period, and a stat of the key found
  nothing. The row is final, and it is never swept again; a write that still lands later is removed
  by the bucket's lifecycle rule (below).

**A key is never final at its first delete.** The first delete marks the row `deleted` with its
`deleted_at`, and that is not the end of the story: a PUT that was in flight when the sweep ran can
land after the delete, and the key would then sit in the store forever, because the bucket is never
listed. So the `deleted` row is deleted once more after the grace period, and its state becomes
`gone`, which is final.

**A client timeout bounds nothing at the store.** The 5-minute PUT timeout (§9) only ends the
worker's wait: a PUT the store accepted can still complete after it, and a worker can pause between
its pre-upload check of the blob row and sending the PUT. So no time-based rule in the table can
prove that the last delete was the last write. The guarantee comes from the store itself:

- every export object is written with the object tag `eyadex-kind=finance-export`,
- the bucket carries a lifecycle rule that expires objects with that tag **2 days** after their
  creation. A published file lives 24 hours (§7), so the rule never removes a file the download
  still serves. The removal is **eventual**: the store counts expiry days from its own day boundary
  and runs the deletion as a background scan, so an object the table lost track of is removed
  within about 3 days, not at an exact hour. That bound covers only the rare late write of §6; every
  key the table knows is deleted by the sweeper as soon as it is dead.

The table's cleanup keeps its job: it removes every known key as soon as it is dead, so a file
outlives its row only in the rare late-write case, and never past the lifecycle rule. The rule is a
server change, listed in §11.

The sweeper is a periodic job (`EXPORT_SWEEP_INTERVAL_MS`).
It deletes a key only when it is sure that no live attempt still needs it.
It reads the export row of every candidate inside `withTenant(clinicId)`, so it knows the row's
current `attempt` and its lease before it deletes anything.

- an `allocated` or an `uploaded` row whose `attempt` is **below the export row's current
  `attempt`** is deleted and set to `deleted` with its `deleted_at`: that attempt lost the race, its
  upload is not the published file, and it can never be published any more,
- an `allocated` or an `uploaded` row whose `created_at` is **older than the build budget plus the
  lease** (15 min + 60 s) is deleted and set to `deleted` with its `deleted_at`: its attempt is past
  the budget of §9 and its lease is long gone, so nothing is uploading under that key any more,
- an `allocated` or an `uploaded` row of the export's **current** attempt is never deleted while the
  export is `running` with a live lease: the upload may be in flight and the publish still needs the
  key,
- every `published` row whose export's `expires_at` has passed is deleted and set to `deleted` with
  its `deleted_at`, and its export becomes `expired` (§7),
- a `deleted` row whose `deleted_at` is **older than the grace period** has its key deleted once
  more, then the sweeper stats the key. Absent: the state becomes `gone`. Still there (a write
  landed between the delete and the stat): the row stays `deleted`, its `deleted_at` moves to now,
  and the next pass after a new grace period tries again. The grace period is longer than the
  build budget, the lease and the PUT timeout together (§9), so a late write is rare, but the rule
  does not rely on it: the lifecycle rule above is the backstop,
- a `gone` row is never swept again: its key was deleted twice and found absent, and a write that
  lands after that is removed by the lifecycle rule,
- a key that is not there is not an error: the sweep is idempotent, and a second run deletes nothing.

The order is always the same: the bytes first, then the row state.
A crash between the two leaves a row that claims a key which is already gone; the next sweep deletes
the missing key and marks the row.
The re-delete of a `deleted` row keeps that order too: the bytes first, then the stat, then the
state becomes `gone`.

The sweeper never lists the bucket. It reads the keys from the table and deletes them one by one.

The sweeper finds its work the way the expiry-reminder scan does: the platform pool lists the clinics,
and each clinic's rows are read and written inside `withTenant(clinicId)` on the app pool.
So the export tables are never read across clinics, and `eyadex_platform` keeps no privilege on them.
Each run takes a bounded batch per clinic (50 rows), and the rest waits for the next run.

The blob store port:

- The port today (`apps/api/src/shared/blob/blob-store.ts`) has `put` and `get` only, and the MinIO
  policy has no `s3:DeleteObject`.
- The pipeline needs two more operations: `delete(key)` (the bytes of a losing attempt, an expired
  file and a refused `own` export) and `exists(key)` (the stat before a row becomes `gone`). `put`
  also takes the object tag `eyadex-kind=finance-export` for the export keys.
- A missing object is not an error (a delete is idempotent). A 5xx or an unreachable store is an
  error, and the sweep is retried at the next run.
- What is missing today, on the code and on the storage side, is a prerequisite of slice 4 and is
  listed in §11.

## 7. Retention, expiry and purge

- The published file lives 24 hours (F3-Q10 a): `expires_at = published_at + 24 hours`, set by the
  publish.
- At `expires_at` the sweeper deletes the key, sets the blob row `deleted` with its `deleted_at`,
  sets the export `expired`, clears `storage_key` and clears `patient_ids`, so no patient id
  outlives the file (EY-10.4).
  The `patient_ids` are cleared **when the row expires**, and on every row whose `expires_at` has
  passed: a `done` row becomes `expired`, and a `purged` row stays `purged` and only loses its
  `patient_ids`.
- The export row itself is never deleted (parent §7.4, CLAUDE.md §5).
- The `own` purge of EY-10.4: when a download is refused because a patient left the requester's
  reach, the file is purged at once.
  The API deletes the key, sets the blob row `deleted` with its `deleted_at`, and sets the export
  `purged` with `storage_key = NULL`.
  The sweeper moves that blob row to `gone` once its grace period has passed and a stat finds the
  key absent (§6).
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
| `patient_ids`     | `uuid[]`      | NULL     | —          | the patients of an `own` export, written by the publish         |
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
- `patient_ids` is null, or the row's `scope` is `own`,
- `status` in (`queued`, `running`, `done`, `failed`, `expired`, `purged`),
- `attempt >= 0`,
- `byte_size` is null or above 0,
- `row_count` is null or not below 0,
- `storage_key` is null, or matches
  `^clinic/[0-9a-f-]{36}/finance-exports/[0-9a-f-]{36}/[0-9]+\.(csv|xlsx)$`.

Primary key `(clinic_id, id)`.

Indexes:

- `(clinic_id, requested_by, created_at)` — the requester's export list (parent §7.3).
- unique `(clinic_id, requested_by) WHERE status = 'running'` — at most one running export per member,
  held by the database at the lease (§2 step 3).
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

| Column        | Type          | Null     | Default | Note                                                        |
| ------------- | ------------- | -------- | ------- | ----------------------------------------------------------- |
| `clinic_id`   | `uuid`        | NOT NULL | —       | the clinic                                                  |
| `id`          | `uuid`        | NOT NULL | —       | a UUID v7 from the application                              |
| `export_id`   | `uuid`        | NOT NULL | —       | the export                                                  |
| `attempt`     | `integer`     | NOT NULL | —       | the attempt that allocated the key                          |
| `storage_key` | `text`        | NOT NULL | —       | the key                                                     |
| `state`       | `text`        | NOT NULL | —       | `allocated` / `uploaded` / `published` / `deleted` / `gone` |
| `deleted_at`  | `timestamptz` | NULL     | —       | when the bytes were deleted                                 |
| `created_at`  | `timestamptz` | NOT NULL | —       |                                                             |
| `updated_at`  | `timestamptz` | NOT NULL | —       |                                                             |

Primary key `(clinic_id, id)`, the standard of every clinic table (CLAUDE.md §5).
The row has an id of its own, like every other clinic table, and not only the key of its attempt.

Unique `(clinic_id, export_id, attempt)`: one row per key ever allocated.

Foreign key `(clinic_id, export_id)` to `finance_report_exports (clinic_id, id)`.
The unique constraint leads with the foreign key's columns, so `db/tests/fk-indexes.sql` is
satisfied.

Checks:

- `attempt >= 1`,
- `state` in (`allocated`, `uploaded`, `published`, `deleted`, `gone`),
- `deleted_at` is not null exactly when the state is `deleted` or `gone`,
- `storage_key` matches
  `^clinic/[0-9a-f-]{36}/finance-exports/[0-9a-f-]{36}/[0-9]+\.(csv|xlsx)$`.

Index `(clinic_id, state, updated_at)` — the sweep of §6.
The re-delete reads the `deleted` rows through it: a row's `deleted_at` is the moment it became
`deleted`, and `updated_at` moved with it, so the two order the rows the same way.

RLS: the same standard policy as §8.1, with its own name.

Grants:

```sql
GRANT SELECT, INSERT ON finance_report_export_blobs TO eyadex_app;
GRANT UPDATE (state, updated_at, deleted_at) ON finance_report_export_blobs TO eyadex_app;
REVOKE ALL ON finance_report_export_blobs FROM eyadex_platform, eyadex_auth, eyadex_dispatcher;
```

The `UPDATE` is column level, like the export table of §8.1: a blob row only ever changes its
state — `allocated` to `uploaded` to `published`, or to `deleted` and then to `gone` — and its
`deleted_at` when the bytes go. Nothing else about it changes.

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
| one upload (the PUT)              | 5 min                | the blob client's own timeout                       |
| the sweep                         | 5 min                | the periodic job                                    |
| the grace period of the re-delete | 21 min               | the sweeper of §6 (build budget, lease and PUT)     |
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
  was taken over, so it writes nothing. The attempt re-reads first (§4): if the re-read shows the
  attempt's own published file, it keeps the file and exits; otherwise it deletes its own upload and
  exits.
  A fifth attempt that is abandoned leaves the row `queued` at the limit, and its next claim writes
  `status = 'failed'` and `error_code = 'attempts_exhausted'` (§5).
- The upload's own budget: a PUT that is not answered in 5 minutes is `store_unavailable` (§5). The
  attempt gives up on it, deletes its own upload and retries on a new attempt, which writes a new
  key. The timeout ends the worker's wait only, not the store's write: a PUT that lands after that
  delete is caught by the sweeper's re-delete and stat (§6), and one that lands even later is removed
  by the bucket's lifecycle rule (§6, §11).

## 10. Tests

The export slice must have these tests.

Unit (the domain):

- the key layout: `clinic/<clinic>/finance-exports/<export>/<attempt>.<ext>`, and the extension
  follows the format,
- the backoff ladder: 1, 5, 30 and 120 minutes, and the fifth attempt is final,
- the failure kinds: `forbidden`, `export_amount_too_large` and `attempts_exhausted` are final, the
  others retry,
- the heartbeat's decision: the runner stops when the renewal updates 0 rows, and it never renews a
  lease that is not live,
- the re-read after a zero-row write: the attempt keeps its file when the export row is `done` with
  its own key and the blob row is `published`, and it deletes its own upload in every other case.
  The re-read comes before the delete, in the heartbeat and in the publish alike, and the decision is
  one decision.

Integration (against PostgreSQL, as `eyadex_app`):

- the hand-off: the request writes the export row and the outbox event in one transaction, and a
  rolled-back request writes neither,
- the claim records the hand-off only: after the claim the row is `running` with a lease and an
  incremented attempt, and no file exists,
- the lease takeover: a row `running` with an expired lease is taken over by the next claim, with
  `attempt + 1` and a new owner,
- the fenced publish: a publish with a stale attempt or a stale owner updates 0 rows and the export
  row is unchanged,
- the publish whose answer was lost: a publish that committed and is replayed updates 0 rows, and the
  attempt keeps its file — the export row stays `done` with its own key, the blob row stays
  `published` and the key is still in the store,
- the zero-row heartbeat after a committed publish: the runner re-reads the row, sees its own
  success and does not delete the key,
- the heartbeat never revives a lease: a heartbeat on a row whose `lease_until` is in the past updates
  0 rows and leaves `lease_until` as it was, and a heartbeat on a `done` or a `failed` row updates
  0 rows and changes nothing,
- the live lease at the publish: a publish whose `lease_until` is in the past updates 0 rows, the blob
  row stays `uploaded` and the audit row is not written,
- the publish moves the blob row: the blob row goes from `uploaded` to `published` in the same
  transaction, and a blob row that is not `uploaded` aborts the whole publish, so the export row and
  the audit row stay as they were,
- one running export per member: two queued exports of one member, leased together, leave one
  `running` and the other `queued` with its event deferred, and the second runs once the first ends,
- the attempt limit: a `running` row with an expired lease at the limit becomes `failed` with
  `attempts_exhausted`, and so does a `queued` row at the limit,
- the sweeper never touches a live upload: the `allocated` and the `uploaded` row of the current
  attempt of a running export with a live lease are not deleted,
- the sweeper deletes the losers: the `allocated` and the `uploaded` row of an attempt below the
  row's current `attempt` are deleted, and so is an `allocated` or an `uploaded` row older than the
  build budget plus the lease,
- the late upload: an attempt whose blob row was swept to `deleted` does not upload at all, and an
  upload that lands after the sweep is deleted by the attempt itself, because the `allocated` to
  `uploaded` update finds `deleted`,
- the stale upload is deleted: the losing attempt's key is gone and its blob row is `deleted`,
- the published file: the publish sets `status`, `storage_key`, `byte_size`, `row_count` and
  `expires_at` (24 hours), and the blob row is `published`,
- the `own` patient set: the publish of an `own` export writes the patient ids of the rows the file
  holds, and the publish of a `clinic` or a `branch` export leaves `patient_ids` null,
- the download of an `own` export: the published row carries the patient ids, and a download of an
  `own` export whose `patient_ids` is null is refused, because the re-check has no patient set,
- the blob row is written before the upload: a failed upload leaves an `allocated` row,
- the sweeper: an `allocated` or an `uploaded` row of a dead attempt is deleted (an attempt below the
  row's current `attempt`, or one older than the build budget plus the lease), an expired `published`
  row is deleted and its export becomes `expired`, and a second run deletes nothing,
- the re-delete of a swept key: a `deleted` row whose `deleted_at` is older than the grace period has
  its key deleted once more, so a key that reappeared after the sweep is caught, and the row becomes
  `gone` only when the stat finds the key absent,
- the late write at the stat: a key that is still there after the re-delete keeps the row `deleted`,
  moves its `deleted_at` and is tried again on a later pass,
- the export tag: every export `put` carries `eyadex-kind=finance-export`, and no other key does,
- the `gone` row is final: a `gone` row is never swept again, and a second run over it deletes
  nothing,
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
  upload, stats a key before its row becomes `gone` (`exists(key)`, §6), and writes every export
  object with the tag `eyadex-kind=finance-export`.

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

**The bucket has no lifecycle rule for exports.** The store needs a rule that expires objects tagged
`eyadex-kind=finance-export` 2 days after creation (§6). The tag is the rule's only filter, so who can
write it decides what the rule may delete:

- only the **worker's** storage user gets `s3:PutObjectTagging`, and only on the resource
  `clinic/*/finance-exports/*`, the same scope as its `s3:DeleteObject`. The API's user never gets it:
  the API uploads no export;
- a server-side check, run once when the policy is applied, proves it: tagging an attachment key as
  the worker's user, and any key as the API's user, is refused.

So an attachment can never carry the tag, and the rule can never delete one.

**All three are a server change, and the owner says yes before slice 4 ships.** The grants and the
rule live on the storage side (the bucket policy, the lifecycle rule and the worker's storage user),
not in the code, so they are prepared
and applied with the owner's own yes, like the production SQL of parent §8.
Until it is in place, the export slice does not ship: a stale key could never be cleaned up.
