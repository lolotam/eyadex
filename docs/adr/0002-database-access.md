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

`@eyadex/db` exports `createDatabase(options)` and three error classes. There are three ways to run
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

Four conditions are refused, all in that one statement, and the order matters because each one names a
different cause:

1. superuser or `BYPASSRLS`, **or any row in `pg_auth_members`** — a role that is merely a _member_ of
   a `BYPASSRLS` role, or of `pg_monitor` / `pg_read_all_data` / `pg_read_all_stats`, passes every
   other check and passes `ping`, and then one `SET ROLE` turns it into a connection that sees
   everything. Zero memberships makes `SET ROLE` inside a transaction impossible rather than merely
   detected.
2. `current_user` is not `options.role` — the wrong URL, reported as "another role".
3. `session_user` is not `current_user` — something already did `SET ROLE` on this connection,
   reported as "the role changed". Checking these two the other way round would call a plain wrong
   login a role change and send an engineer looking for a `SET ROLE` that never happened.

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

`app.clinic_id` is a GUC the wrapper sets, so the code inside `fn` is trusted to keep its hands off
it. Three things enforce that, in order.

**1. The statement guard — `fn` cannot send the statement in the first place.** `tx.execute()` reads
the statement text with the transaction's own dialect, skips leading whitespace, `--` line comments,
nested `/* … */` block comments and the opening paren of a wrapped sub-select, then refuses with
`ForbiddenStatementError` (a `TypeError`, because a forbidden statement is a programming error, not a
database failure):

- any statement whose **first word** is `BEGIN`, `START`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`,
  `SAVEPOINT`, `RELEASE`, `PREPARE`, `SET`, `RESET`, `DISCARD`, `DO`, `CALL`, `LOCK`, `LISTEN`,
  `UNLISTEN`, `LOAD` or `COPY` — case-insensitive, whole word, so `SETTLE` is not `SET`;
- any statement containing `set_config` **anywhere**, in any case;
- any statement carrying a **second statement** — a `;` followed by something other than whitespace.

Why a first-word check is sound — and why the third rule is not optional. The extended protocol runs
exactly one statement per `Parse`/`Bind`/`Execute`, so a `COMMIT` cannot hide behind a `SELECT`
**when the query is parameterised**. But postgres.js does not choose the extended protocol for a query
with no bound parameters: `unsafe()` sets `simple: args.length === 0`
(`postgres/src/index.js`), and the **simple protocol accepts several statements in one call**. A
parameterless `SELECT 1; COMMIT` written inside `fn` would therefore pass a first-word check and
commit the wrapper's transaction half-done — `closing-check.db.spec.ts` sees the session afterwards,
but the write is already durable. Refusing any `;` that has content after it closes that path. The
check reads the **raw** text rather than the comment-stripped body on purpose: a `;` inside a string
literal is refused too, because stripping comments without a real lexer is exactly how
`SELECT '--'; COMMIT` would slip through. The guard **fails closed** here and at `set_config`: one
harmless query refused is a smaller problem than one contract a keyword can walk around.

Savepoints stay legal: `tx.transaction(…)` asks Drizzle for a savepoint, and Drizzle issues it on its
own session rather than through `fn`'s door.

**2. The closing check — the second layer, still there.** Before the COMMIT, one statement reads the
session again (`current_setting('app.clinic_id', true)`, `current_user`, `session_user`, both timeouts)
and, in the same statement, clears `app.clinic_id` at session level. Any difference from what the
wrapper opened throws `TenantContextViolationError` and rolls the rest back. The guard stops the
statement; this catches the session changing by some other route — a refactor, a different driver path,
a bug in this package. `closing-check.db.spec.ts` runs exactly that scenario: it breaks the session on a
raw transaction, bypassing the guard on purpose, and pins all six breaches, a hand-rolled `COMMIT` and
`ROLLBACK` included.

**3. The grants.** `eyadex_platform` has no grant on `patients` at all, so "the platform console reads a
patient" is `42501` from PostgreSQL and no code path exists. `eyadex_app` has no `CREATE` on schema
`public`, so it cannot create a function that would run as somebody else.

**What none of them catches: data read and sent elsewhere inside `fn`.** The boundary is which code is
allowed inside `fn`; the wrappers are a backstop, not a sandbox. Never build SQL from input with
`sql.raw`.

**The residual risk the guard cannot see is a pre-existing `SECURITY DEFINER` function that calls
`set_config`** — it would move the clinic from inside the wrapper's own transaction, where no
statement-level check can see it. There is none: the `SECURITY DEFINER` functions in the baseline
(`invitation_clinic_for_token` in `0014`, `email_hold_matches` and the trigger helpers in `0015`/`0017`)
only _read_ `current_setting('app.clinic_id', true)`, they are owned by `NOLOGIN` roles with narrow
grants, and no runtime role can create a new one (`REVOKE CREATE ON SCHEMA public FROM PUBLIC` in
`0013`). If a future migration adds a definer function that writes a GUC, this ADR is revisited with
it.

### Why `fn` receives a guarded transaction, and why it has no query builders

`Tx` is a `Proxy` with an allow-list of **three** members: `execute`, `transaction` (savepoints) and
`rollback`. Everything else throws a `TypeError`: `session`, `_`, `dialect`, `$client`, `query`,
`select`, `constructor`, symbols, the prototype, and any assignment. `Tx` is that allow-listed type
itself, so `tx.session` and `tx.select()` do not compile either.

The query builders are gone on purpose, and that was a real hole rather than a style choice:
`tx.select()` returns a genuine Drizzle builder, and `builder.session.client` is the raw postgres.js
client. With it a caller runs `set_config('app.clinic_id', <other clinic>, false)` and reads another
clinic's patients, outside every check, every audit and every timeout in this file — and `insert`,
`update`, `delete`, `with`, `$with` and `$count` all lead to the same client. B3a has no schema, so it
needs none of them. **They come back in B3b only behind a wrapper that guards every value a builder
hands out**, or not at all.

The handle is `Proxy.revocable`: after the wrapper's COMMIT or ROLLBACK it is revoked, so a `tx` kept
past the end of the transaction throws instead of running queries on the pooled connection. A savepoint
callback receives a guarded inner transaction with the same statement guard, and that one is revoked
when the savepoint returns. What `execute` returns is postgres.js `Row` objects in a plain array: the
driver hangs `count` / `command` / `columns` / `statement` off it, and none of those is a way back to
the client — `guarded-tx.db.spec.ts` pins that by name.

### Wrappers never nest — per `Database`, not globally

`withTenant` called from inside another wrapper's `fn` on the **same instance** would wait for a
connection the outer transaction already holds; on a pool of size 1 the outer transaction dies on its
own idle timeout. An `AsyncLocalStorage` marker (`node:async_hooks`) makes any wrapper call — or `ping`
— on the same `Database` reject with a `TypeError` before a connection is taken.

The marker records _which instances_ are running, because two `Database` objects have two pools:
`platform.withNoTenant(…)` inside `app.withTenant(…)` is legitimate work, not a deadlock, and refusing
it would break real flows. Each transaction's token is switched off when that transaction ends, so work
scheduled inside `fn` that runs afterwards is not treated as nested.

### Timeouts

`statement_timeout` and `idle_in_transaction_session_timeout` are both set from
`transactionTimeoutMs` (default 10 s, 1…600 000). The server cancels the work, so the limit still holds
if the Node event loop stalls — a client-side timer cannot promise that. The connection is released as
soon as the server aborts; `lifecycle.db.spec.ts` pins that.

The bound is **per statement plus per idle gap, not per transaction**: a transaction that keeps issuing
short statements runs as long as it likes. `transaction_timeout` (PG17+) would bound the whole
transaction and is deliberately **not** used: a red-team probe terminated the session mid-write and
crashed the driver process on postgres 3.4.9. Revisit when the driver handles it.

The closing statement compares both timeouts against the configured value, so a timeout changed behind
the guard's back still fails before the COMMIT rather than silently removing the bound.

Connection **setup** is bounded separately, by `connectTimeoutSeconds` (default 10 s, 1…60), passed to
postgres.js as `connect_timeout`. Without it a host that swallows packets leaves `ping` waiting out the
TCP timeout — minutes — and a readiness probe is exactly the wrong place to wait.

### No raw client, anywhere

The postgres.js client and the Drizzle instance live in a closure. The returned object has exactly five
functions, and `public-surface.spec.ts` pins the export list, because a package whose escape hatch is a
raw `drizzle()` handle is a package the RLS can be routed around.

### `DatabaseError`

Drizzle wraps every query failure in `DrizzleQueryError`, whose message contains the SQL and its
parameters, and whose inner `PostgresError` carries `detail` — `Failing row contains (…)` is patient
data. The wrappers rethrow every database failure as `DatabaseError`, which carries **only** the
SQLSTATE `code` and, when PostgreSQL names them, `constraint` / `schema` / `table` / `column`. No
`cause`, no query, no parameters, no detail, and a fresh stack.

The conversion happens only for a **genuine** driver failure, checked with `instanceof` against the real
classes (`DrizzleQueryError` from `drizzle-orm`, and `postgres.PostgresError`, which the pinned 3.4.9
exports on the factory at runtime). An error thrown by `fn` that merely carries a SQLSTATE-shaped `code`
— `{ code: "23505" }`, or an `Error` whose `cause` has one — is rethrown as the same object, because
converting it would report a use case's own validation failure as a database error. For the same reason
the `cause` chain of an arbitrary error is never walked: only `DrizzleQueryError`'s own `cause`, one
level, is looked at, and only when it is a real `PostgresError`.

### Accepted limitations

- **Odd-but-valid UUIDs pass the shape check.** Uppercase and the nil UUID match the regex; the value
  travels as a bound parameter, so it matches no rows rather than being a hole.
- **A statement whose text contains `set_config` is refused even when it is harmless.** The same
  fail-closed rule refuses a `;` with content after it, so `SELECT 'a;b'` and a trailing `;` followed
  by a comment are refused too. See the guard above.
- **This closes the parameterless simple-protocol path.** postgres.js runs a query with no bound
  parameters on the simple protocol, which accepts several statements per call; the guard refuses a
  second statement rather than trusting the protocol. Parameterised queries already run on the
  extended protocol, where PostgreSQL rejects more than one statement at `Parse`.
- **A promise chain created outside a transaction and resolved inside it carries no marker.** The
  nesting guard lives in `AsyncLocalStorage`, and a chain that was born in a different context inherits
  nothing, so the guard cannot see it. Combined with the connect timeout, the result is that such a
  call **fails** instead of hanging: the wait for a connection the transaction already holds is bounded
  by `transactionTimeoutMs`, and the connection setup is bounded by `connectTimeoutSeconds`. Work that
  needs the outer transaction has to be awaited inside it, not handed across.
- **`host:port` can appear in transport errors from the driver.** A connection failure is rethrown
  unchanged, because it carries no SQLSTATE and no query. `DatabaseError` never does this.
- **`close()` waits for in-flight work** up to the driver timeout (`end({ timeout: 5 })`).
- **`tx.execute()` still runs any other SQL.** See the trust boundary above.

### `withUser` is deliberately deferred

`withUser` would set `app.user_id`. Nothing in the database reads it today (`db/sql/0013`), and no
identity tables exist yet — they arrive with Better Auth in `packages/auth`. Adding a wrapper whose
context has no consumer would be a promise the database cannot keep, so it waits until there is a user
to name.

## Consequences

- The schema is **not** in this package yet. Queries here are `tx.execute(sql\`…\`)`, and the query
builders are deliberately absent until B3b. The Drizzle mirror of `db/sql/0001…0021`, the drizzle-kit
  bridge and the drift test are the next task.
- `withTenant` never accepts a non-UUID: it rejects with a `TypeError` before sending anything, and the
  value is always a bound parameter.
- An exception from `fn` rolls everything back and rethrows the original error unchanged, so a use case
  can read its own failure and translate it.
- A database error crosses the wrapper boundary as `DatabaseError` with identifiers only — a caller
  cannot recover the offending values from it, by design. Anything that is not a driver failure crosses
  as itself.
- A statement that would move the clinic, end the transaction or change the session is refused before it
  is sent, so it never takes effect even transiently; the closing check still catches the same breach
  arriving by another route.
- `withNewTenant` refuses an id that already exists, so a duplicated or injected `IdGenerator` cannot
  write onboarding rows into a live clinic.
- Every clinic table added later still needs its policy **and** its negative isolation test in the same
  PR (CLAUDE.md §5.1), plus `*.db.spec.ts` coverage where the wrapper behaviour is what guarantees it.

### Next

B3b — the Drizzle schema mirror, the drizzle-kit bridge and a drift test against `db/sql`. The query
builders return there only if every value they hand out is guarded.
