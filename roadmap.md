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
- [x] Phase B: drizzle-kit bridge, inspection only (2026-10-09): pinned `drizzle-kit` 0.31.11, `pnpm --filter @eyadex/db db:pull`, every other command refused (ADR-0024)
- [ ] Agent integrations (MCP) — deferred until the NestJS backend exists (user decision)

## Phase B — tenancy module (apps/api)

- [x] Domain rules (clinic access, user/branch limits, OD-7 last branch, feature flag) + unit tests
- [x] ClinicReader / BranchReader ports, `@eyadex/db` persistence, read queries, TenancyModule (not mounted)
- [x] Run `test:db` in CI on PostgreSQL 18; regenerate `pnpm-lock.yaml` for the new apps/api deps

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
- [x] Retention of idempotency keys (platform ledger and `clinic_idempotency_keys`): 30 days, worker purge (ADR-0022, SQL 0040)
- [x] Slice 7: users + invitations API — invite/resend/cancel (outbox `clinic.user_invited`, sealed token, rotation), lists, role/branches, deactivate/reactivate with session revoke, last admin and user limit under the users lock, stranded-member confirmation on branch deactivation (ADR-0012, no SQL)
- [x] Slice 7b-1: worker dispatches `clinic.admin_invited` and `clinic.user_invited` through Resend with the send-time check (ADR-0013)
- [x] Slice 7b-2: the worker auto-cancels pending invitations left with no active branch (ADR-0013 §12)
- [x] Slice 7c-1: platform SMTP fallback for worker mail (ADR-0014)
- [x] Slice 7c-2a: clinic mail provider table, sealed credentials, use cases and worker test send (ADR-0014)
- [x] Slice 7c-2a routes: `/v1/clinic/mail-provider` (settings → identity through index.ts, owner decision 2026-10-07)
- [x] Slice 7c-2b: route clinic mail through the clinic provider, failure count, degrade after 3
- [x] Worker production image (ADR-0015; Dokploy service: orchestrator)
- [x] Slice 9: patients API — search (POST body), branch options, audited opens, idempotent create, update, archive/restore under branch scope and the `patients` flag; web HTTP adapter wired (ADR-0018, no SQL)
- [x] Retention of dispatched and failed outbox rows: dispatched 30 days, failed 90 days, pending never (ADR-0022, SQL 0040)
- [x] Slice 8: custom roles — create/update/deactivate/reactivate with the locked admin role, hidden module keys kept, unique names, idempotent create, `role_in_use`, delegation model (stored keys + branch scope under a `roles:` lock) on every path that defines or grants a role, audit + cache bump; user editor options under `view:users` (`/v1/users/role-options`, `/branch-options`, deferred from PR #46) (ADR-0017, no SQL)
- [x] Slice 10: audit log read — `GET /v1/clinic/audit`, `/v1/platform/audit` (+ `/clinics`); patient rows kept from the platform by grants; actor names via `platform_audit_actors` (ADR-0019, SQL 0034)
- [x] Slice 11: clinic settings, my account (Better Auth password change), platform overview with computed "expired" + effective status filter, platform settings (new clinics take the default trial), platform team (invite/accept/deactivate/reactivate, last active account, gate on every platform request), expiry banner and the worker's pre-expiry reminder email (ADR-0020, SQL 0036–0038)
- [x] Reverse-proxy routes `app.`/`platform.` `/api/*` → api with `/api` stripped (live in production; the staging hosts get the same routes, `docs/specs/staging-runbook.md` §5)

## Slice W1 — web wired to the real API

- [x] HTTP `ApiClient` adapter next to the mock, chosen by `VITE_API_MODE` (default `mock`)
- [x] Real sign-in (email + password, platform TOTP enrolment with QR), area-host guard, coming-soon states
- [x] `build:all` with Node 24 / `NITRO_PRESET=node-server` (orchestrator; CI `verify` job)
- [x] Clinic-side limits read and platform clinic read with time zone / language / created date (W2)
- [x] Platform default trial days for new clinics (slice 11); default user/branch limits and modules are platform settings the create form pre-fills (owner decision 2026-10-09, ADR-0020 amendment, SQL 0041)

## Slice W2 — platform clinic list, usage reads, clinic time zone, server-side trial

- [x] `GET /v1/platform/clinics` (platform staff, cursor, filters, total) + web list wired (ADR-0016)
- [x] Platform detail gains `timezone`, `defaultLanguage`, `createdAt`
- [x] `GET /v1/branches/usage`, `GET /v1/users/usage`; web counters no longer nullable
- [x] New clinic `trialDays` computed on the API clock in the clinic zone; subscription saves end at the clinic's local midnight
- [x] Slice 8 note: the user editor's option lists are `GET /v1/users/role-options` and `/branch-options` under `view:users:clinic` (done in slice 8)
- [x] Slice 8 follow-up (issue #93): a role's view key must cover its write's scope (`clinic` covers `branch` and `own`, `branch` covers `own`), checked on the saved set after hidden module keys are merged (`role_hidden_keys_invalid`, 409) (PR #98)
- [x] Apply `db/sql/0031` to production (orchestrator)
- [x] Switch production to `VITE_API_MODE=http` (owner, 2026-10-09; prod smoke test green) — after the same SHA has run on staging, which is built with `http` from day one (ADR-0021)

## Slice 12 — staging (ADR-0021)

- [x] Env-driven hosts and cookies: web `VITE_APP_HOST` / `VITE_PLATFORM_HOST` (unset = production rules), API `AUTH_COOKIE_PREFIX` (unset = production names); a staging host is never an area in production, and the reverse
- [x] Security headers on every API answer and every web page (`X-Frame-Options` / `frame-ancestors` in http builds; `noindex` on area hosts)
- [x] First platform account bootstrap (`dist/bootstrap-platform-account.js`, password on stdin, fresh database only)
- [x] `docker/smoke-test.sh` and `docs/specs/staging-runbook.md`
- [x] Create the `-staging` Dokploy services, migrate, bootstrap and smoke-test (2026-10-08/09; smoke 31/31, db/tests 17/17)
- [x] Reserve `staging-app` / `staging-platform` as clinic slugs (owner decision 2026-10-09)
- [x] The bootstrap writes a `platform_account.bootstrapped` platform audit row (owner decision 2026-10-09, SQL 0039)

## Appointments (post-MVP phase 1, `docs/specs/appointments-design.md`)

- [x] Slice A1: `appointments` module flag (a new-clinic default module), catalogue keys (`overbook`, `own`), services, booking profile on the user editor, weekly schedules per branch (D-14 midnight continuity), time off — as tabs of the clinic Settings page (D-17); admin keys backfilled for existing clinics (ADR-0026, SQL 0042)
- [x] Apply `db/sql/0042` to staging, then production, right before the A1 deploy (orchestrator)
- [x] Global lock order (ADR-0027): the schedule save locks the membership row before the branch row (the A1 deadlock Codex found); three-session test
- [x] Slice A2: appointments — book, reschedule, status, cancel, quick file, overbook; branch day view + booking dialog; new clinics' receptionist books in its branches (ADR-0026 §11, SQL 0043)
- [x] Apply `db/sql/0043` to staging, then production, before the A2 deploy (orchestrator)
- [x] Slice A3: the clinic day starts at its first real instant (a skipped midnight west of UTC); the `own` scope on appointments and patients (D-4); new clinics' doctor sees its own appointments and patients (ADR-0026 §12, SQL 0044)
- [x] Apply `db/sql/0044` to staging, then production, before the A3 deploy (orchestrator)
- [x] Slice A4: provider week, month (`GET /v1/appointments/week`, `/month`) and today's queue (the branch day) as Day / Week / Month / Today views; no SQL (ADR-0026 §13)

## Post-MVP phase 2 — visits, notes, medical file (`docs/specs/medical-design.md`)

- [x] Field encryption (`FieldCipher`, key configuration) and the civil ID stored encrypted with an exact-match index, plus the backfill command (ADR-0028, SQL 0045)
- [x] `medical` module flag and catalogue keys; visits (start from an arrived appointment or walk-in), four-section notes, signing, addenda, the five-section medical file, per-patient note search, visit list and module guards (ADR-0029, SQL 0046)
- [x] Diagnoses (free text or ICD-10-CM) and the ICD-10-CM table and loader (ADR-0029 §9–10, SQL 0047)
- [x] Prescriptions with the printable view, and the clinic's medicines list (ADR-0029 §9, §11, SQL 0048)
- [x] Attachments over the `BlobStore` port, encrypted (SQL 0049, merged with PR #68)
- [x] Release: existing clinics' system roles gain the medical keys by `system_key`, new clinics' default roles hold them, `medical` joins the new-clinic default modules (ADR-0029 §12, SQL 0050, `db/maintenance/medical-release-catch-up.sql`)
- [x] The platform's audit INSERT policy refuses `appointment` rows too, as its read policy and view do (SQL 0051; 0046 is applied on staging, so it stays unedited)
- [x] Apply `db/sql/0045`–`0051` to staging, then production, each before the deploy that needs it (orchestrator)
- [ ] Load ICD-10-CM after 0047 (orchestrator)
- [x] Fix: FY2027 ICD-10-CM codes with a letter second (`QA0…`) are accepted (PR #75)
- [ ] After the release deploy, run `db/maintenance/medical-release-catch-up.sql` on staging, then production, before the platform switches `medical` on for any clinic (orchestrator)
- [x] Drop the plain `civil_id` column: SQL 0052 (refuses while a plain number remains) and code that never names it; the backfill command is removed (ADR-0028, R1-6)
- [x] Apply `db/sql/0052` on staging, then production, each only AFTER the deploy whose code no longer names `civil_id` is live there: the older API still reads and writes the column and breaks once it is gone (orchestrator)
- [x] The production migration ledger holds every file up to `0067` (2026-10-20)

## Post-MVP phase 3 — patient notifications (`docs/specs/notifications-design.md`)

- [x] N1: patient email notifications — settings, patient email and message language, the `patient_notifications` ledger, scanner and worker send handler (ADR-0031, SQL 0053–0056, PR #72)
- [x] N2: patient messages over WhatsApp — Evolution QR link and Meta Business coexistence (ADR-0032, SQL 0057–0058, PR #73)
- [x] N3: WhatsApp delivered/read through the Meta status webhook, and Embedded Signup (SQL 0059, PR #76)

## Post-MVP phase 4 — finance (`docs/specs/finance-design.md`)

- [x] F1: service and per-doctor prices, invoices and lines, gap-free numbers per branch and year, void, send by email or WhatsApp (send queue and link token storage), platform revenue totals only (ADR-0033, SQL 0060–0063, PR #78); PDF delivery status is tracked below
- [x] F1 follow-ups: backend and web (PR #84), the invoice list names each patient (PR #85), review follow-ups (PR #87)
- [ ] F1: invoice PDF delivery — renderer and proofs merged (#156–#161); delivery stack (#162–#171, including the existing web button in #168) and worker (#172–#178) are in review on HOLD, pending the owner's separate decision (owner handoff, 2026-11-13; not independently verified locally)
- [x] F2 design: manual payments, credit, refunds and cash closing, with ADR-0034 (PR #89)
- [x] F2 slice 1: contracts (PR #90)
- [x] F2 slice 2: payments SQL, RLS and negative tests (SQL 0064–0067, PR #92; applied on staging and production 2026-10-20)
- [x] F2 slice 3: settlement domain (PR #94)
- [x] F2 slice 4: payments and credit API (PR #95)
- [x] F2 slice 5: refunds, cash closings, receipt, platform totals v2 (API) (PR #99); receipt PDF delivery status is tracked below
- [x] F2 slice 6: web (Lovable)
  - [x] Card 1a: payments, patient credit, settlement on invoices, payment methods (mock = API)
  - [x] Card 1b: receipts list and receipt page, «المدفوعات» tab, receipt link in the success toast
  - [x] Card 2a: refunds (dialog, movements, refunds list), finance strip as nav, platform collected/refunded
  - [x] Card 2b: the cash closing (preview, close dialog, history, detail, menu entry) — in review as a PR to main; the create-only role seeing no branches is accepted (owner decision 2026-10-23)
- [x] Invoice line price fills from the service price (doctor price first; owner decision 2026-10-24)
- [ ] F2: receipt PDF delivery — renderer and proofs merged (#156–#161); delivery stack (#162–#171, including the existing web button in #171) and worker (#172–#178) are in review on HOLD, pending the owner's separate decision (owner handoff, 2026-11-13; not independently verified locally)
- [x] F3: reports (outline, `finance-design.md` §5)
  - [x] Slice 3 card B: web `reports` client (HTTP + mock R1–R10), slice 2b stored fields in the mock, `report_range_too_long` in the web catalogue
  - [x] Slice 5: the report screens (R1–R10, cards 1–7)
  - [x] CSV/XLSX export opened on production on 2026-11-02 and the first real export was verified (owner handoff, 2026-11-13; not independently verified locally)
  - [ ] Owner: check an XLSX export and real report rows; not a web task
- [ ] F4: online payment and insurance (outline, `finance-design.md` §6) — outside launch scope

## Finance F3 — report screens

- [x] Card 1: PR #140 follow-ups (A1–A5) + shared report frame + R1 «الإيراد اليومي» + R2 «ملخص الفترة»
- [x] Card 2: PR #141 follow-ups (A1–A4) + R9 «سجل إقفال الصندوق»
- [x] Card 3: #143 (download hook commit-only identity) + R3 «الإيراد حسب الخدمة» + R4 «الإيراد حسب الدكتور» (table only)
- [x] Card 4: R5 «المبالغ المستحقة» (cursor pages, age-bucket cards)
- [x] Card 5: R6 «أرصدة المراجعين»
- [x] Card 6: R7 «المستردات» + R8 «الخصومات» (PR #147)
- [x] Card 7: R10 «ملخص فواتيري»

## Production launch (reconciled with the owner handoff, 2026-11-13)

- [x] Card 0: reconcile the roadmap and readiness plan with the owner-uploaded handoff; production and PR states above remain attributed to that handoff, not independent verification
- [x] Local branch check: `origin/main` (`fb569ccf`) is an ancestor of `feat/f3-export-web`; no local content merge is needed (GitHub's current branch state is not independently verified)
- [x] Web Card 2a: confirmed `visits/use-list-flush.ts` and `shared/api/new-clinic-finance.ts` already use the compatibility APIs; separated the badge/button/toggle/navigation/form non-component exports and the encounter-slots provider, clearing six lint warnings without behaviour changes
- [ ] Web Card 2b: five warnings remain in the API, i18n and persona providers and the oversized sidebar primitive; split them in a bounded follow-up rather than touching hundreds of import sites or the 744-line sidebar in this slice
- [ ] Web Card 1: accessibility and print pass on finance screens after the PDF delivery stack merges and is synced; do not rebuild the existing PDF buttons
- [ ] Owner: separately decide whether to lift the PDF HOLD; orchestrator then merges #162–#171 in order after staging checks and a backup
- [ ] Orchestrator: PDF worker pipeline #172–#178 and its remaining worker, storage and activation slices after the HOLD lift and gates
- [ ] Owner/orchestrator: F3 inputs — taxed R3/R4 row, production permission smoke, owner XLSX/real-rows checks, disposition of expanded data gaps, and final F3 receipt
- [ ] Orchestrator: confirm and complete the ICD-10-CM load and `medical-release-catch-up.sql` on staging and production
- [ ] Orchestrator: backups with a tested restore, error monitoring, real email/WhatsApp delivery
- [ ] Release gates on Node 24 / pnpm 12.5.1 and staging check for every persona (ar/en, 1440/390, print)
- [ ] R9 read-only check on the first clinic with real closings (no seeded data)
- [ ] Owner: launch go/no-go

Out of launch scope: F4, per-clinic public pages and landing-page builder, specialty sections, and AI. Each needs its own specification and owner decisions before implementation.
