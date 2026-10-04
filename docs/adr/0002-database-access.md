# 0002 — The sanctioned path to PostgreSQL

- **Status:** Accepted
- **Date:** 2026-10-04
- **Phase:** B (`packages/db`)

## Context

`apps/api` and `apps/worker` are the only runtime processes that touch the database, and the isolation
between clinics is not a code convention — it is the database. Every clinic-owned table has RLS
**enabled and forced** and its policies read exactly one thing:
`clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid`. Nothing reads `app.user_id`
(`db/sql/0013`). Four runtime roles exist (`db/sql/0013`, PRD §4.5): `eyadex_app` for the API and the
worker, `eyadex_platform` for the platform module, plus `eyadex_auth` and `eyadex_dispatcher` which
have no wrapper yet. No runtime role has `BYPASSRLS`, and `eyadex_platform` has no grant at all on
`patients` — that is the guarantee that the Eyadex team can never see patient data.

So the failure this ADR closes is not "a query returns the wrong rows". It is **a connection that runs
with more power than anyone thinks**: a `DATABASE_URL` pointing at the owner role, at a role that is
a _member_ of a `BYPASSRLS` role, or at `eyadex_platform` where `eyadex_app` was expected, would
either ignore every policy in the database or fail somewhere far from the cause. A connection string
is environment data, and environment data gets copied.

## Decision

`@eyadex/db` exports `createDatabase(options)` and two error classes. There are three ways to run
work, and no fourth.

- **`withTenant(clinicId, fn)`** — one transaction with `app.clinic_id` set to `clinicId`. This is the
  only way to reach clinic data.
- **`withNewTenant(fn)`** — the same, for a clinic that does not exist yet: the id comes from the
  injected `IdGenerator`, `app.clinic_id` is set to it, and it is handed to `fn`. Onboarding runs here
  as `eyadex_platform` (`db/sql/0014`). It rejects on `eyadex_app`, before any query, and it refuses an
  id that already belongs to a clinic.
- **`withNoTenant(fn)`** — `app.clinic_id` set to the **empty string**. Every clinic table returns zero
  rows; it is the path for accepting an invitation, where `invitation_clinic_for_token(token_hash)`
  (SECURITY DEFINER) is the one thing that may answer before any clinic is known.

### Isolation, not authorization

`withTenant` is a **tenant-isolation primitive**, not an access-control decision. It trusts the clinic
id it is handed: whoever holds the connection string chooses the clinic, and `withTenant` makes that
choice consistent for one transaction. Whether that user may act _in_ that clinic is decided above the
wrapper — session valid, clinic allowed, module enabled, role holds the permission, branch scope
(CLAUDE.architecture.md §3 layers 1–5). RLS is layer 6, the last line. A caller that can reach
`withTenant` with a clinic id can already read that clinic's rows by design, so authorization must not
be deferred to the wrapper, and no caller should be handed a clinic id it did not derive from an
authorized request.

### Why the role and its privileges are re-checked in every transaction

The first statement of every transaction sets the settings **and** reads the session in one round
trip:

```sql
SELECT current_user, session_user,
       (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged,
       EXISTS (SELECT 1 FROM pg_auth_members m
                WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user))
         AS member_of_another_role,
       set_config('app.clinic_id', $1, true),
       set_config('statement_timeout', $2, true),
       set_config('idle_in_transaction_session_timeout', $2, true)
```

A mismatch throws before `fn` runs, so the transaction rolls back and `fn` never sees a row. This is
deliberately cheap and deliberately repeated: the pool hands out connections that were opened earlier,
possibly by a different deployment, and a check done once at boot would only describe the moment it
ran. `set_config` is transaction-local, so the settings die with the rollback too.

Four conditions are refused, all in that one statement:

1. `current_user` is not `options.role` — the wrong URL.
2. `current_user` is superuser or has `BYPASSRLS` — the owner URL, which would ignore every policy.
3. `session_user` is not `current_user` — something already did `SET ROLE` on this connection.
4. **`pg_auth_members` has any row for the role.** This is the one that is easy to miss. A role that
   is merely a _member_ of a `BYPASSRLS` role, or of `pg_monitor` / `pg_read_all_data` /
   `pg_read_all_stats`, passes every other check and passes `ping`, and then one `SET ROLE` inside
   `fn` turns it into a connection that sees everything. Zero memberships makes `SET ROLE` inside a
   transaction impossible rather than merely detected.

The refusal message names the **expected** role (`the connection must log in as eyadex_app`). It never
contains the URL, the host, the port or the password: those live in `options.url`, and an error message
is the one thing that reliably ends up in a log line and in someone's terminal. The package logs nothing
at all, and `ping()` applies the same rule for `/ready`.

### Why `''` is set explicitly in `withNoTenant`

A pooled connection can arrive with a session-level `app.clinic_id` already on it — left by other code
on the same connection, or by a previous transaction that set it outside our wrappers. Policy reads
`NULLIF(current_setting(...), '')::uuid`, so an empty string and an unset value both mean "no clinic".
Setting `''` inside every `withNoTenant` transaction therefore means the same thing under either
starting state. Omitting the assignment would make "no tenant" depend on connection history.

### What RLS through a GUC does and does not buy

`app.clinic_id` is a GUC the wrapper sets, so the code inside `fn` is trusted to keep its hands off it.
`tx.execute(sql\`…\`)`can still run any SQL at all, and the closing check catches four of the five
ways`fn`can break the contract — a re-pointed clinic, a changed role, a changed timeout, and a manual`COMMIT`/`ROLLBACK` (which drops the transaction-local value and is caught as a changed clinic).

**It does not catch the fifth: data read and sent elsewhere inside `fn` before it returns.** If `fn`
selects another clinic's rows — reachable today only if it re-points the GUC first, which the closing
check does catch after the fact — and writes them into a queue, a log or a webhook payload, the damage
is done before the wrapper ever looks. The guard is a backstop against sloppy context handling, not a
sandbox: the boundary is which code is allowed inside `fn`, and the grants are what stop `fn` from
reading rows it has no grant for. **Never build SQL from input with `sql.raw`** — the value would be
concatenated into a statement the RLS then applies the wrong way, and no check in this package can see
it.

### Why `fn` receives a guarded transaction, not the Drizzle object

`Tx` is a `Proxy` with an allow-list of twelve members — the query builders, `$with`, `$count`,
`execute`, `transaction` (savepoints) and `rollback`. Everything else throws a `TypeError`:
`session`, `_`, `dialect`, `$client`, `query`, `constructor`, symbols, the prototype, and any
assignment. `Tx` is exported as that allow-listed `Pick`, so `tx.session` does not compile either.

The reason is concrete: `tx.session.client` is the raw postgres.js client, and with it a caller can
run `set_config('app.clinic_id', <other clinic>, false)` and read another clinic's patients outside
every check, every audit and every timeout in this file. The transaction handle is also
`Proxy.revocable`: after the wrapper's COMMIT or ROLLBACK it is revoked, so a `tx` kept past the end
of the transaction throws instead of running queries on the pooled connection. A savepoint callback
receives a guarded inner transaction and that one is revoked when the savepoint returns.

### Wrappers never nest

`withTenant` called from inside another wrapper's `fn` would wait for a connection the outer
transaction already holds; on a pool of size 1 the outer transaction dies on its own idle timeout.
An `AsyncLocalStorage` marker (`node:async_hooks`) makes any wrapper call — or `ping` — inside a
running transaction reject with a `TypeError` before a connection is taken.

### Timeouts

`statement_timeout` and `idle_in_transaction_session_timeout` are both set from
`transactionTimeoutMs` (default 10 s, 1…600 000). The server cancels the work, so the limit still holds
if the Node event loop stalls — a client-side timer cannot promise that. The connection is released as
soon as the server aborts; `lifecycle.db.spec.ts` pins that.

The bound is **per statement plus per idle gap, not per transaction**: a transaction that keeps issuing
short statements runs as long as it likes. `transaction_timeout` (PG17+) would bound the whole
transaction and is deliberately **not** used: a red-team probe terminated the session mid-write and
crashed the driver process on postgres 3.4.9. Revisit when the driver handles it.

The closing statement compares both timeouts against the configured value, so `SET statement_timeout = 0`
inside `fn` is caught before the COMMIT rather than silently removing the bound.

### No raw client, anywhere

The postgres.js client and the Drizzle instance live in a closure. The returned object has exactly five
functions, and `public-surface.spec.ts` pins the export list, because a package whose escape hatch is a
raw `drizzle()` handle is a package the RLS can be routed around.

### `DatabaseError`

Drizzle wraps every query failure in `DrizzleQueryError`, whose message contains the SQL and its
parameters, and whose inner `PostgresError` carries `detail` — `Failing row contains (…)` is patient
data. The wrappers rethrow every database failure as `DatabaseError`, which carries **only** the
SQLSTATE `code` and, when PostgreSQL names them, `constraint` / `schema` / `table` / `column`. No
`cause`, no query, no parameters, no detail, and a fresh stack. An error thrown by `fn` that is _not_ a
database error is rethrown as the same object, so a use case can still read its own failure.

### Accepted limitations

- **Odd-but-valid UUIDs pass the shape check.** Uppercase and the nil UUID match the regex; the value
  travels as a bound parameter, so it matches no rows rather than being a hole.
- **`host:port` can appear in transport errors from the driver.** A connection failure is rethrown
  unchanged, because it carries no SQLSTATE and no query. `DatabaseError` never does this.
- **`close()` waits for in-flight work** up to the driver timeout (`end({ timeout: 5 })`).
- **`tx.execute()` can run any SQL.** See the trust boundary above.

### `withUser` is deliberately deferred

`withUser` would set `app.user_id`. Nothing in the database reads it today (`db/sql/0013`), and no
identity tables exist yet — they arrive with Better Auth in `packages/auth`. Adding a wrapper whose
context has no consumer would be a promise the database cannot keep, so it waits until there is a user
to name.

## Consequences

- The schema is **not** in this package yet. Queries here are `tx.execute(sql\`…\`)`. The Drizzle
mirror of `db/sql/0001…0021`, the drizzle-kit bridge and the drift test are the next task.
- `withTenant` never accepts a non-UUID: it rejects with a `TypeError` before sending anything, and the
  value is always a bound parameter.
- An exception from `fn` rolls everything back and rethrows the original error unchanged, so a use case
  can read its own failure and translate it.
- A database error crosses the wrapper boundary as `DatabaseError` with identifiers only — a caller
  cannot recover the offending values from it, by design.
- `withNewTenant` refuses an id that already exists, so a duplicated or injected `IdGenerator` cannot
  write onboarding rows into a live clinic.
- Every clinic table added later still needs its policy **and** its negative isolation test in the same
  PR (CLAUDE.md §5.1), plus `*.db.spec.ts` coverage where the wrapper behaviour is what guarantees it.

### Next

B3b — the Drizzle schema mirror, the drizzle-kit bridge and a drift test against `db/sql`.
