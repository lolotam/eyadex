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

`app.clinic_id` is a GUC the wrapper sets, and the code inside `fn` is **trusted application code**:
it runs in the same process and could open a connection of its own if it wanted to. What is below is
a **guard-rail against mistakes and injected fragments, not a sandbox**. A text check over SQL can
never be complete — PostgreSQL builds and runs SQL out of strings — which is why the guard is
fail-closed, an **allow-list** rather than a deny-list, and backed by the grants instead of being the
only thing standing there. Never build SQL from input with `sql.raw`.

`tx.execute()` is the only door to SQL, and three things stand in front of it.

**1. One statement, rendered once.** `execute` accepts a genuine Drizzle `SQL` and nothing else:
`is(query, SQL)` from `drizzle-orm`, and anything else is a `TypeError` **before** anything is
rendered. The statement is then rendered **exactly once** with the transaction's own dialect, the
guard reads that text, and that frozen text and those parameters are what go to the driver
(`unsafe(text, params)` on the transaction's own handle — the same call Drizzle makes, in
`postgres-js/session.js`), so the result `fn` sees is still the postgres.js rows array. Checking one
rendering and sending another was a hole, not a style choice: a `SQLWrapper` inside a real `SQL` can
return different text on its second `getSQL()`, and a benign `SELECT` then landed as `set_config`.

**2. The statement guard.** It reads the raw text and refuses with `ForbiddenStatementError` (a
`TypeError`: a forbidden statement is a programming error, not a database failure). The rules, in the
order they are applied:

- `U&` — a Unicode-escaped identifier (`U&"…"`) or string (`U&'…'`) is refused **whole**, because
  `\005f` spells the `_` of `set_config` without showing a single letter of the name. Reading the
  escapes is not attempted; there is no legitimate caller writing them.
- `set_config` anywhere, in any case: the only way a `SELECT` can move `app.clinic_id` or a timeout.
- `pg_settings` anywhere: the view carries an update rule, so `UPDATE pg_settings SET setting = …` is
  `set_config(…, false)` at **session** level without the word appearing (Codex on PR #22, P2).
- the **PostgreSQL 18 core functions that execute a query given as text** — `query_to_xml`,
  `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `cursor_to_xml`, `cursor_to_xmlschema`,
  `ts_stat`, `ts_rewrite`. That list (`TEXT_EXECUTING_FUNCTIONS`) is **the complete set of core
  functions that run text as SQL**; an extension that does the same (`dblink`, for one) must be added
  to it or never installed. `query_to_xml('select set_' || 'config(…)')` moves the clinic with no
  forbidden word in the text at all, which is why the function names are refused, not the strings.
- **functions whose effect outlives the transaction or reaches another connection**
  (`SESSION_SCOPED_FUNCTIONS`): the session-level `pg_advisory_lock*` / `pg_try_advisory_lock*`
  (the lock stays held on the pooled connection after COMMIT, and every other transaction waiting
  for the key blocks until its timeout) and `pg_terminate_backend` / `pg_cancel_backend` (the role
  can signal any other connection of the same role). The transaction-scoped
  `pg_advisory_xact_lock*` forms stay available; they are released at COMMIT.
- a **second statement** — a `;` with anything but whitespace after it.
- an **unterminated `/*` comment**, or nothing left to read once the comments are stripped: nothing to
  check is not something `fn` may send. The guard fails closed instead of waving it through.

The statement kind comes next, and it is an **allow-list**: the first word — case-insensitive, whole
word, after the leading whitespace, comments and the opening paren of a wrapped sub-select — must be
one of `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`, `VALUES`, `TABLE`, `MERGE`. Those are the
statements that read or write rows. Everything else is refused **by name**, including everything a
deny-list would have had to keep guessing at: `ALTER ROLE … SET` (a timeout that persists on the role
for every future session), `CREATE FUNCTION pg_temp.…` (refused here by kind, and impossible since `db/sql/0022`),
`EXECUTE` / `DEALLOCATE` (which can run the protocol-level prepared statements postgres.js itself
created — `pg_prepared_statements` lists `commit`), `GRANT`, `TRUNCATE`, `VACUUM`, `CHECKPOINT`,
`DECLARE` / `FETCH` / `CLOSE`, `NOTIFY`, `SET ROLE`, `DROP`, `EXPLAIN`. The refusal names the first
word, lists the allowed kinds, cites this ADR, and carries no SQL text and no parameters.

Reading the text is PostgreSQL's, not JavaScript's, because the difference is the whole game:

- whitespace is exactly `[ \t\n\r\f\v]`, the set the PostgreSQL lexer skips — not JS `\s`, which also
  eats NBSP and `U+2028`;
- a `--` comment ends at `\n` **or** `\r`, which is the rule in the lexer (`newline [\n\r]`). Reading
  only `\n` turned `sql.raw("--\rselect set_config(…)")` into an "empty" statement and re-pointed the
  clinic;
- `/* … */` comments nest, so the skip is a counter, not an `indexOf`;
- every content check runs on the **raw text**, never on the stripped body. The body only says which
  kind of statement this is. This is also why a `;` inside a string literal, `set_config` inside a
  comment and a `/*` inside a quoted value are all refused: one harmless query refused is a much
  smaller problem than one contract a keyword can walk around.

Why a first-word check is sound — and why the multiple-statement rule is not optional. The extended
protocol runs exactly one statement per `Parse`/`Bind`/`Execute`, so a `COMMIT` cannot hide behind a
`SELECT` **when the query is parameterised**. But postgres.js does not choose the extended protocol for
a query with no bound parameters: `unsafe()` sets `simple: args.length === 0`
(`postgres/src/index.js`), and the **simple protocol accepts several statements in one call**. A
parameterless `SELECT 1; COMMIT` inside `fn` would pass a first-word check and commit the wrapper's
transaction half-done — the closing check sees the session afterwards, but the write is already
durable. Parameterless queries therefore still go through the multiple-statement rule.

Savepoints stay legal: `tx.transaction(…)` asks Drizzle for a savepoint, and Drizzle issues it on its
own session rather than through `fn`'s door.

**3. The closing check — the second layer, with an honest limit.** Before the COMMIT, one statement
reads the session again (`current_setting('app.clinic_id', true)`, `current_user`, `session_user`, both
timeouts) and, in the same statement, clears `app.clinic_id` at session level. Any difference from
what the wrapper opened throws `TenantContextViolationError` and rolls the rest back. The guard stops
the statement; this catches a session that changed by some other route — a refactor, a different
driver path, a bug in this package. `closing-check.db.spec.ts` runs exactly that scenario: it breaks
the session on a raw transaction, bypassing the guard on purpose, and pins all six breaches, a
hand-rolled `COMMIT` and `ROLLBACK` included. **What it cannot see is a change that was restored**:
a clinic re-pointed to another clinic and put back before `fn` returns leaves the session exactly as
the wrapper opened it, so it passes — and so does data read and sent somewhere else inside `fn`. The
boundary is which code is allowed inside `fn`.

**4. The grants.** `eyadex_platform` has no grant on `patients` at all, so "the platform console reads a
patient" is `42501` from PostgreSQL and no code path exists. `eyadex_app` has no `CREATE` on schema
`public`, so it cannot create a function that would run as somebody else.

**The residual risk the guard cannot see is a pre-existing `SECURITY DEFINER` function that calls
`set_config`** — it would move the clinic from inside the wrapper's own transaction, where no
statement-level check can see it. There is none: the `SECURITY DEFINER` functions in the baseline
(`invitation_clinic_for_token` in `0014`, `email_hold_matches` and the trigger helpers in `0015`/`0017`)
only _read_ `current_setting('app.clinic_id', true)`, they are owned by `NOLOGIN` roles with narrow
grants, and no runtime role can create a new one (`REVOKE CREATE ON SCHEMA public FROM PUBLIC` in
`0013`). If a future migration adds a definer function that writes a GUC — or an extension that runs
SQL given as text — this ADR is revisited with it.

### Why `fn` receives a guarded transaction, and why it has no query builders

`Tx` is a `Proxy` with an allow-list of **three** members: `execute`, `transaction` (savepoints) and
`rollback`. Everything else throws a `TypeError`: `session`, `_`, `dialect`, `$client`, `query`,
`select`, `constructor`, symbols, the prototype, and any assignment, prototype replacement
(`Object.setPrototypeOf`) or freezing — without those traps the operation would land on the raw
transaction itself. `rollback` is captured when the guard is created, never looked up on the target again. A method taken from `tx` (`const execute = tx.execute`) ends with its transaction or
savepoint too: every method the proxy hands out checks the `Tx`'s lifetime on each call, because
`Proxy.revocable` only stops new reads (Codex on PR #22, P1). A savepoint's lifetime is tied to its parent's, and a
`tx.transaction(…)` that `fn` started without awaiting is refused: if `fn` (or a savepoint) returns while
a child savepoint is still running, the wrapper throws `TenantContextViolationError`
(`unfinished-savepoint`) and rolls back instead of committing — postgres.js only waits for a savepoint
through the promise handed back to the caller, so the child would otherwise run after the COMMIT.
The same holds for a `tx.execute(…)` that `fn` did not await (`unfinished-statement`): the wrapper waits
for it to settle (each statement is bounded by `statement_timeout`), handles its rejection so it can
never surface as an unhandled rejection, and rolls back. Driver errors are scrubbed inside
`tx.execute` itself, so even a rejection nobody awaited carries no `detail`. And the `Tx` closes the
moment `fn` returns — before the closing check, not after it — so a method kept in a timer cannot
queue a write between the check and the COMMIT (Codex on PR #22, P1 ×2).
What counts is whether `fn` **observed** the work, not whether it is still running: the promise
`tx.execute` / `tx.transaction` hands back records being awaited (or used through `then`, `catch`,
`Promise.all`). A savepoint `fn` fired and forgot that failed early has already settled, yet `fn` never
learned it failed — so any work `fn` never observed, finished or not, succeeded or not, is refused and
rolled back (Codex on PR #22, P1). "Observed" means the failure path is handled — `await`, `catch`,
`then(…, onRejected)`; `then(onFulfilled)` alone and `finally` pass the failure on, so they hand back a
promise that carries the same record forward to whoever handles it. `Tx` is that allow-listed type
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
when the savepoint returns. `execute` takes a real Drizzle `SQL` — a string or an object with
`toQuery` is a `TypeError` — renders it once and sends exactly that text, and returns postgres.js
`Row` objects in a plain array: the driver hangs `count` / `command` / `columns` / `statement` off it,
and none of those is a way back to the client — `guarded-tx.db.spec.ts` pins that by name.

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
converting it would report a use case's own validation failure as a database error.

**A real driver failure that `fn` catches and wraps is scrubbed, not converted.** `fn` may rethrow a
`PostgresError` as `new Error("…", { cause })`; the wrapper is `fn`'s and stays the same object with
the same message, but its `cause` would carry PostgreSQL's `detail` (the whole failing row — patient
data) and a `DrizzleQueryError` the query and its parameters. So the wrapper walks the `cause` chain and
an `AggregateError`'s `errors` — at most eight levels, cycle-safe — and replaces every **genuine**
driver failure it finds with a `DatabaseError` (identifiers only). Past the cap nothing is read, so
nothing is trusted: the rest of the chain is cut off and replaced by a plain "chain cut" error. SQLSTATE-shaped values of `fn`'s own
are left alone. If a holder cannot be written (a frozen error), it fails closed: the whole error becomes
that `DatabaseError` (or the plain "chain cut" error). (Codex on PR #22, P1.)

### Accepted limitations

- **Whether `fn` really consumed a promise cannot be proven at run time.** The wrapper guarantees that
  nothing runs after the `Tx` closes, that work still running or never awaited is refused and rolled
  back, and that no rejection surfaces unhandled or carries driver details. But a combinator `fn` throws
  away (`void Promise.all([tx.transaction(…)])`) attaches its own rejection handler, so the savepoint
  looks consumed. That is `fn` ignoring its own errors — not a way across clinics or around a
  timeout — and the tool for it is static: typed linting with `@typescript-eslint/no-floating-promises`
  (`ignoreVoid: false`) on every package that calls the wrappers, a follow-up to this ADR.

- **The guard reads text, not a parse tree, and `fn` is trusted code.** PostgreSQL can build and run
  SQL out of strings (plpgsql, an extension, a `SECURITY DEFINER` function), so no text check can be
  complete. What the package guarantees is narrower and real: the statement `fn` hands over is the
  statement that is sent, only the eight allowed kinds go through, the known session-movers are
  refused by name, and the closing check fires if the session is not what the wrapper opened. The
  grants are the layer that does not depend on reading text at all.
- **A change that was restored is invisible to the closing check.** Re-pointing `app.clinic_id` inside
  `fn` and putting it back before `fn` returns leaves the session exactly as the wrapper opened it, so
  the transaction commits — and so does any data read while the clinic was moved, sent elsewhere
  inside `fn`. The boundary is which code is allowed inside `fn`, not what the wrapper can see.
- **The list of text-executing functions is the PostgreSQL 18 core set**, and it is the whole of it.
  `dblink` (or any extension that runs SQL given as text) has to be added to
  `TEXT_EXECUTING_FUNCTIONS` or must never be installed; the guard cannot see a name that is not there.
- **Odd-but-valid UUIDs pass the shape check.** Uppercase and the nil UUID match the regex; the value
  travels as a bound parameter, so it matches no rows rather than being a hole.
- **Harmless statements are refused on purpose (fail closed).** A value between quotes containing
  `set_config`, a `;` inside a literal or a trailing `;` followed by a comment, a `/*` inside a quoted
  value or an unbalanced one, a `U&` in any position, and any text naming one of the text-executing
  functions — all refused. See the guard above.
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

**Temporary objects are the grants' job, not the guard's.** `SELECT … INTO TEMP patients` starts
with an allowed word, and a text check cannot tell that `INTO` from `INSERT INTO` or `MERGE INTO`;
with `TEMPORARY` it created a temp table that shadowed the real one for the rest of the pooled
session. `db/sql/0022` revokes `TEMPORARY` on the database from `PUBLIC` and from every runtime role,
so PostgreSQL refuses it with `42501` (`guard-bypasses.db.spec.ts`), the same way it refuses a
`DELETE` the role has no grant for.

### Follow-ups this ADR does not implement

- **A token-gated tenant context, if `fn` ever has to be untrusted.** Today RLS reads
  `app.clinic_id` directly, so anything that can set a GUC can move the clinic. The shape that closes
  it is for the policies to read a clinic that only a `SECURITY DEFINER` setter can write, with the
  setter taking the value from a token the caller cannot read. Until that exists, `fn` stays trusted
  application code and the guard stays a guard-rail.

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
  arriving by another route. The statement is rendered **once**, so what the guard reads is what the
  driver sends, and only the eight allowed statement kinds are sent at all.
- `withNewTenant` refuses an id that already exists, so a duplicated or injected `IdGenerator` cannot
  write onboarding rows into a live clinic.
- Every clinic table added later still needs its policy **and** its negative isolation test in the same
  PR (CLAUDE.md §5.1), plus `*.db.spec.ts` coverage where the wrapper behaviour is what guarantees it.

### Next

B3b — the Drizzle schema mirror, the drizzle-kit bridge and a drift test against `db/sql`. The query
builders return there only if every value they hand out is guarded.
