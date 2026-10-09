# ADR-0024 — drizzle-kit bridge: inspection only

- Status: accepted (owner decision 2026-10-09: drizzle-kit in check/inspection mode only)
- Date: 2026-10-09

## Context

B3b (ADR-0002, Next) left one item open: a `drizzle-kit` bridge for the Drizzle schema mirror in
`packages/db/src/schema`. `db/sql` + `db/migrate.sh` are the only way to change a database (CLAUDE.md
§5.1), and `schema-drift.db.spec.ts` already compares the mirror with a migrated database: columns,
defaults, primary keys in order, foreign keys with their actions, full index definitions, CHECK
definitions and the view. The owner chose to add drizzle-kit for inspection only; `generate`, `push`
and `migrate` must not be exposed.

### What drizzle-kit 0.31.11 actually does here (measured on PostgreSQL 18, baseline 0001–0040)

- `drizzle-kit check` validates the snapshots of a drizzle-kit migrations folder. This repo has none, so
  it verifies nothing about the mirror or a database.
- `drizzle-kit pull` introspects a database and writes `schema.ts`, `relations.ts`, a snapshot and a
  CREATE script. It fetched all 28 tables, 226 columns, 36 indexes, 50 foreign keys, 56 checks, 27
  policies and both views — but its snapshot is lossy for this baseline:
  - composite primary-key and UNIQUE columns come back in **alphabetical** order:
    `idempotency_keys_pkey` as `(key, scope)` (the table has `(scope, key)`),
    `auth_accounts_provider_id_account_id_key` as `(account_id, provider_id)`;
  - in the expression index `roles_name_ar_unique` the plain column `clinic_id` is marked as an
    expression and the operator classes are shifted by one (`text_ops` on `clinic_id`, `uuid_ops` on
    `lower(btrim(name_ar))`);
  - it has no notion of `FORCE ROW LEVEL SECURITY` or of grants.
- Diffing that snapshot against the mirror with drizzle-kit's own engine (`generateMigration`) produced
  241 statements for a mirror the drift test proves exact: every CHECK dropped and re-added with the
  same definition (the kit writes `scope <> ''::text`, the mirror `(scope <> ''::text)`), every index
  re-created (the kit adds operator classes), the composite keys above re-created, plus
  `DISABLE ROW LEVEL SECURITY` and `DROP POLICY` for every tenant table because the mirror does not
  model RLS.

So drizzle-kit can neither check the mirror more precisely than the drift test nor be trusted to write
to a database that relies on forced RLS. A "pull, then diff against the mirror" report would either
print those 241 spurious statements or filter them out — and then skip exactly the levels where drift
matters (key column order, index operator classes, CHECK text, RLS) while still printing "no
differences". **No diff-report script is offered**: the exact comparator is `schema-drift.db.spec.ts`
(`pnpm --filter @eyadex/db test:db`), which already runs in CI.

## Decision

1. **`drizzle-kit` 0.31.11, pinned exactly, devDependency of `@eyadex/db` only.** It was released on
   2026-09-21 in the same minute as `drizzle-orm` 0.45.3 (the version the repo pins); 0.31.x declares no
   peer range, so the pairing rests on that shared release, not on a declared dependency. It is older
   than the 24h `minimumReleaseAge`; nothing was added to `minimumReleaseAgeExclude`.
2. **One script: `pnpm --filter @eyadex/db db:pull`** (`drizzle-kit pull`) against
   `DRIZZLE_DATABASE_URL`, a database migrated with `db/migrate.sh`. Its output lands in
   `packages/db/.drizzle-pull/` (gitignored, emptied at every run). Its use is authoring: when a new
   `db/sql` file adds a table, `schema.ts` is a starting point for the mirror file — copied, then
   corrected by the rules in `packages/db/AGENTS.md` (key column order and expression indexes above
   must be re-checked against the SQL). The comparator stays `schema-drift.db.spec.ts`.
3. **`packages/db/drizzle.config.ts` refuses every other command** (`push`, `generate`, `migrate`,
   `check`, `studio`, `drop`, `up`, `export`) before drizzle-kit connects or writes, and refuses `pull`
   when `DRIZZLE_DATABASE_URL` is unset — there is no default URL. `drizzle-config.spec.ts` runs the
   real binary for each refused command. **This is a guard rail against accidents, not a security
   boundary:** drizzle-kit only reads this file when it is invoked through it, so
   `drizzle-kit push --dialect=… --schema=… --url=…` run directly skips every refusal (Codex review of
   PR #61). Anyone holding a writable URL can change that database with any client (`psql` included);
   the boundary is the credentials — production and staging URLs live only in Dokploy (CLAUDE.md §8),
   and the URLs on a developer machine point at throwaway local containers. Hence the rule in
   `packages/db/AGENTS.md`: run drizzle-kit only through `pnpm --filter @eyadex/db db:pull`, never
   `exec drizzle-kit …`, and never with a production or staging URL.
4. **The session is read-only.** The config adds `default_transaction_read_only=on` (and an
   `application_name`) to the URL; postgres.js, the only driver `@eyadex/db` installs, sends them as
   startup parameters, so a write fails with "cannot execute … in a read-only transaction". Checked on
   2026-10-09: during a `db:pull` the server listed a session with
   `application_name = eyadex-drizzle-kit-pull` (the URL parameters reach it), and postgres.js with the
   same URL answers `SHOW default_transaction_read_only` with `on` and refuses `CREATE TABLE`. This
   holds only while drizzle-kit uses postgres.js: it prefers `pg` when that package is resolvable from
   `packages/db` (today it is not).
5. **`allowBuilds: esbuild: false`** in `pnpm-workspace.yaml`. drizzle-kit brings esbuild 0.18.20,
   0.25.12 and 0.28.2 (plus tsx); without the key `pnpm install --frozen-lockfile` stops with
   `ERR_PNPM_IGNORED_BUILDS` (checked on 2026-10-09). The
   platform binary arrives as an optional dependency, so the postinstall is not needed (`db:pull` runs
   with it off).

## Consequences

- Production never runs drizzle-kit. CI runs the binary only in `drizzle-config.spec.ts` (the unit
  suite, no database) to prove the refusals; the drift test remains the only automatic schema check.
  No CI step runs `db:pull`: its output is an authoring aid, not a verdict.
- A drizzle-kit migrations folder, `generate` or `push` would need a new owner decision and a new ADR
  (the switchover in ADR-0002), and the lossy points above would have to be fixed upstream first.
- Upgrading drizzle-kit means re-running `db:pull` once and re-reading this list of lossy points.
- `.drizzle-pull/` is ignored by git, Prettier and ESLint.
