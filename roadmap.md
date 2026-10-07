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
- [x] Slice 2b: Better Auth over HTTP, same-origin per area (ADR-0004): host-bound areas, `/auth/*` allowlist, `SessionGuard`, mandatory platform TOTP, per-user `/two-factor/enable` lock
- [x] Slice 2c: Redis rate limiting of sign-in, two-factor, change-password (ADR-0005; fail closed)
- [x] Slice 3a: `POST /v1/platform/clinics` — clinic + system roles + first-admin invitation + email hold + platform audit + outbox in one transaction, Idempotency-Key (ADR-0006, SQL 0025–0026)
- [x] Slice 3b: `POST /v1/invitations/{inspect,accept}` — single-use acceptance, clinic account + membership, retry-safe across the two DB roles (ADR-0008)
- [x] Worker: dispatch `clinic.admin_invited` (open the sealed link, send, scrub payload) — slice 7b-1, ADR-0013
- [x] Slice 4: global `AccessGuard` (one declaration per route), PRD §4.7 check order, versioned Redis authorization cache, `GET /v1/me`, `/v1/roles`, `/v1/permissions/catalogue` (ADR-0009, SQL 0027)
- [x] Slice 5: `@RequiresFeature` module gate, platform feature/subscription/limits/detail endpoints, `ClinicLimits` port (ADR-0010)
- [x] Slice 6: branches API (list/create/update/deactivate/reactivate), in-transaction branch limit + OD-7 under a clinic lock, idempotent create in `clinic_idempotency_keys`, SQL 0028 (ADR-0011)
- [x] Slice 6 open: stranded members resolved in slice 7 (ADR-0012)
- [ ] Retention of idempotency keys (platform ledger and `clinic_idempotency_keys`)
- [x] Slice 7: users + invitations API — invite/resend/cancel (outbox `clinic.user_invited`, sealed token, rotation), lists, role/branches, deactivate/reactivate with session revoke, last admin and user limit under the users lock, stranded-member confirmation on branch deactivation (ADR-0012, no SQL)
- [x] Slice 7b-1: worker dispatches `clinic.admin_invited` and `clinic.user_invited` through Resend with the send-time check (ADR-0013)
- [x] Slice 7b-2: the worker auto-cancels pending invitations left with no active branch (ADR-0013 §12)
- [x] Slice 7c-1: platform SMTP fallback for worker mail (ADR-0014)
- [x] Slice 7c-2a: clinic mail provider table, sealed credentials, use cases and worker test send (ADR-0014)
- [x] Slice 7c-2a routes: `/v1/clinic/mail-provider` (settings → identity through index.ts, owner decision 2026-10-07)
- [x] Slice 7c-2b: route clinic mail through the clinic provider, failure count, degrade after 3
- [x] Worker production image (ADR-0015; Dokploy service: orchestrator)
- [ ] Retention of dispatched and failed outbox rows (TODO(spec))
- [ ] Slice 8: role CRUD (call `AuthorizationInvalidator`)
- [ ] Reverse-proxy routes `app.`/`platform.` `/api/*` → api with `/api` stripped (orchestrator)
