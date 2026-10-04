# Roadmap

- [x] Clinic area: branches
- [x] Product rebrand: Eyadex
- [x] Marketing landing page (/ Arabic, /en English, sign-in moved to /login), built with scroll-craft
- [x] Marketing positioning updated for every clinic specialty; front-desk role renamed to Receptionist throughout
- [x] Clinic area: users and invitations
- [x] Arabic app reviewer terminology, clinic audit categories, and three component splits
- [x] Clinic area: roles and permissions (catalog matrix, locked admin role, hidden module keys kept on save)
- [x] Clinic area: patients (branch scope, file numbers, duplicate phone, archive/restore, audited file opens)
- [x] Audit log: clinic (filters, clinic time zone, field diff) and platform (administrative entries only)
- [x] Settings and platform console: clinic settings, my account, expiry banner, platform overview, team and settings (last Phase A screens)
- [x] Phase B: monorepo foundation (pnpm + Turborepo workspace; app in `apps/web`, Zod contracts in `packages/contracts`, shared presets in `packages/config`)
- [x] Phase B: api + worker skeletons, ids, observability (NestJS on Fastify with `/v1/health`, the bilingual error envelope and one request id per request; `packages/ids`, `packages/observability`)
- [x] Phase B: `packages/db` runtime wrappers (`withTenant` / `withNewTenant` / `withNoTenant`, `ping`, `close`)
- [x] Phase B: Drizzle schema mirror (`@eyadex/db/schema`) + drift test against `db/sql`
- [ ] Phase B: drizzle-kit bridge (needs a pinned `drizzle-kit` added with the repo's pnpm; the preview sandbox can't update the lockfile)
- [ ] Agent integrations (MCP) — deferred until the NestJS backend exists (user decision)

## Phase B — tenancy module (apps/api)

- [x] Domain rules (clinic access, user/branch limits, OD-7 last branch, feature flag) + unit tests
- [x] ClinicReader / BranchReader ports, `@eyadex/db` persistence, read queries, TenancyModule (not mounted)
- [ ] Run `test:db` in CI on PostgreSQL 18; regenerate `pnpm-lock.yaml` for the new apps/api deps

## Phase B — identity foundation

- [x] `packages/auth` (Better Auth 1.7.7: email + password, sign-up disabled, two-factor, sessions in PostgreSQL, one cookie per area) + `db/sql/0023` auth tables granted to `eyadex_auth` only
- [ ] Slice 2b: HTTP auth routes, TOTP enforcement on the platform host, invitation acceptance
