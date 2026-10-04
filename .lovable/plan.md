# B3b — Drizzle schema mirror for packages/db

Goal: give the backend a typed description of every table that already exists in production (`db/sql/0001–0022`), plus an automatic check that the two never drift apart. No database change, no new tables, no new query paths.

## What gets built

1. **Schema mirror** — `packages/db/src/schema/`, one file per business area:
   - `clinics.ts` (clinics, clinic_features)
   - `branches.ts`
   - `roles.ts` (roles, permissions, role_permissions)
   - `memberships.ts` (memberships, membership_branches, email reservations)
   - `invitations.ts` (invitations, invitation_branches)
   - `patients.ts` (patients, file-number counter)
   - `audit.ts` (audit_log, platform_audit_log, platform_clinic_admin_audit view)
   Columns, types, CHECK enums, primary keys `(clinic_id, id)`, uniques, FKs and indexes copied exactly from the SQL. No defaults for ids (app-generated UUID v7). Each file ≤300 lines.
2. **drizzle-kit bridge** — `packages/db/drizzle.config.ts` pointing at the schema, with `introspect`/`check` only. `generate`/`push`/`migrate` are disabled: `db/sql` + `db/migrate.sh` stay the only way to change production until the owner decides the switchover.
3. **Drift test** — `packages/db/src/__tests__/schema-drift.db.spec.ts`: on a fresh PostgreSQL 18 with the whole `db/sql` baseline applied (same as CI `db` job), read `information_schema`/`pg_catalog` and compare tables, columns, types, nullability, PKs, uniques, FKs and indexes with the Drizzle mirror. Any difference fails CI.
4. **Guarded exposure** — the schema objects are exported as table definitions only. Query builders on `Tx` stay absent (ADR-0002); a follow-up decides whether to add them under the same statement guard. A unit test asserts the public surface still has no raw client.
5. **Docs** — ADR-0002 "Next" section updated to mark B3b done; one AGENTS.md rule: "Drizzle schema in packages/db mirrors db/sql and is checked by the drift test; db/sql remains the source of truth until the switchover."

## Out of scope

- Any edit to `db/sql/`, `db/migrate.sh` or `db/tests/`.
- Query builders, repositories, API modules, auth.
- Frontend changes.

## Technical details

- Use `drizzle-orm/pg-core` (`pgTable`, `uuid`, `text`, `integer`, `boolean`, `timestamp({ withTimezone: true })`, `primaryKey`, `unique`, `index`, `foreignKey`, `check`), pgView for the platform audit view (`.existing()`).
- RLS/policies and grants are not modelled in Drizzle; the existing `db/tests/rls-isolation.sql` keeps covering them.
- Drift test runs under `vitest.db.config.ts` (`pnpm --filter @eyadex/db test:db`), skipped when no test database URL is set, matching the other `*.db.spec.ts` files.
- Add `drizzle-kit` as a pinned devDependency (respecting the 24h supply-chain guard in pnpm-workspace.yaml).
- Verify: typecheck, lint 0 errors, unit tests, db tests locally against compose Postgres, update roadmap.md.
