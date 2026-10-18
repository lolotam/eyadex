# CLAUDE.md — Project rules for AI-assisted development (Eyadex)

> Read this file fully before any task. The names say "CLAUDE", but the rules apply to every
> agent equally (Claude, Codex, Lovable, Cursor, humans).
>
> **The documents that govern this project:**
>
> - `docs/PRD-Eyadex-MVP.md` — **what** we build (product scope, user stories, decisions, slices).
> - `CLAUDE.architecture.md` — **how the code is shaped** (folders, layers, dependency rules).
> - **This file** — the day-to-day rules every agent must obey while writing a slice.
>
> On conflict: the PRD wins on product scope, `CLAUDE.architecture.md` wins on structure and
> dependency direction, this file wins on workflow. The engineering reference for Phase B is the
> PosPay foundation (PRD §4.2); where PosPay and this repo disagree, this repo wins.
> If a rule conflicts with a request, **stop and ask** — never silently break a rule.
>
> **Changelog**
>
> - **V1.0 (2026-10-03)** — Initial version, adapted from PosPay CLAUDE.md V3.7 for Eyadex
>   (clinic instead of company, no money/POS/offline), covering Phase A (Lovable frontend) and
>   Phase B (NestJS API + worker, PostgreSQL RLS, Drizzle).
> - **V1.1 (2026-10-06)** — §2.1: the orchestrator fixes review findings itself (max 5 rounds);
>   the loop lives in `.claude/skills/eyadex-delivery-loop/SKILL.md`.
> - **V1.2 (2026-10-13)** — §0.1: every reply to the owner is in Egyptian Arabic (owner rule).
> - **V1.3 (2026-10-17)** — §2 and §2.1: small slices (about 3,000 changed lines, one story per
>   PR), at most 3 review rounds, and only blocking findings hold a merge (owner decision after
>   PR #78). Lovable's standing lessons live in `.lovable/review-lessons.md`.
>   `CLAUDE.architecture.md` §9 follows the same rule.
> - **V1.4 (2026-10-17)** — §1 and §3 describe Phase B as it is today (API, worker and
>   `packages/db` exist; `VITE_API_MODE` picks mock or HTTP; `db/sql` stays the only way to change
>   a database), keeping the web hard limits. Follow-up to PR #79.
> - **V1.5 (2026-10-17)** — §2 step 2 and §9 label their rules by part (API, web mock adapter)
>   instead of by phase, so Phase A being done retires none of them; §3 lists `packages/auth` and
>   `packages/secrets`. `CLAUDE.architecture.md` §1–2 and §9 and PRD §4.1, §5.3–5.4 and §8.2 follow
>   Phase B and ADR-0024. Follow-up to PR #80.
> - **V1.6 (2026-10-18)** — §9: each integration test connects as its use case's own runtime role
>   (`eyadex_app` for tenant paths, `eyadex_platform`, `eyadex_auth`, `eyadex_dispatcher`
>   otherwise). `CLAUDE.architecture.md` A1.2: §2.2 gains the `billing` row, §8 and `AGENTS.md` name
>   both web adapters, and it records PR #81's §2.2 cycle rule (rejected in review until the §7
>   check lands) and §7 split (checks that run today vs planned). PRD 1.3: §4.1 describes the worker
>   as it runs (outbox poller + interval jobs, no BullMQ; owner decision 2026-10-18) and §5.4 step 5
>   keeps the mock. Follow-up to PR #81.

## 0.1 Talking to the owner (binding, owner rule 2026-10-13)

- **Every message to the owner is in Egyptian colloquial Arabic, always**: answers, questions,
  status lines, progress updates, summaries and reports, even when the owner writes in English.
  An English reply is a mistake. Switch only if the owner asks for English in that same message.
- Keep English words to a minimum: write the idea in plain Arabic first. Identifiers, file paths,
  commands, model names, error codes and UI labels stay verbatim (in code formatting or «») inside
  the Arabic sentence; never translate them.
- This covers conversation only. Code, comments, commit messages, PR titles and bodies, and
  English project docs keep English unless the owner asks otherwise. Journey files and reports
  written for the owner are in Arabic.

## 0. What this project is

Eyadex (eyadex.com): multi-tenant clinic-management SaaS for **every clinic specialty**
(dermatology, psychiatry, OB/GYN, general practice…): one fixed core shared by all clinics plus
specialty sections on top. Arabic-first + English, RTL. Kuwait first. Modular monolith. Solo
developer + AI agents.

**Product vocabulary (binding in UI copy):**

- The people a clinic serves are **"المراجع / المراجعون"** in Arabic (never "المريض / المرضى" in
  UI text). English app UI says "Patients"; the marketing site says "patients and clients".
  Code identifiers stay `patients` (resource, routes, table).
- The front-desk role is **"موظف استقبال / Receptionist"** (system key `receptionist`). The word
  "كاشير / Cashier" must not appear anywhere.
- The brand is written `Eyadex` in Latin letters in both languages.

## 1. Phases — know which one you are in

| Phase       | Where                                    | What exists                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (done)    | `apps/web`                               | the TanStack Start frontend against an in-memory mock adapter, Zod contracts in `packages/contracts`, the SQL baseline in `db/sql`                                                                                                                       |
| **B (now)** | pnpm monorepo from the PosPay foundation | `apps/web` (Lovable's part, reviewed by agents), `apps/api` + `apps/worker` (NestJS on Fastify), `packages/*` (`auth`, `config`, `contracts`, `db`, `ids`, `observability`, `secrets`), `db/sql` + `db/migrate.sh` (PostgreSQL 18, forced RLS; ADR-0024) |

The web picks its data source at build time with `VITE_API_MODE`: the in-memory mock (the
default; Lovable's preview and the tests) or the HTTP adapter against `apps/api`. Web hard limits,
still binding: **no Lovable Cloud, no Supabase, no database access from the frontend, no server
functions with business logic.** All data goes through the single `ApiClient` interface; screens
never import an adapter, so switching between mock and HTTP requires no screen change.

## 2. Workflow — one vertical slice at a time

1. Never implement a whole module. Implement **one slice** (e.g. "Users and invitations"): one
   user story or one screen group, about 3,000 changed lines; above 5,000 lines or 100 files,
   split it before starting.
2. Order inside a slice: **contract (Zod) → SQL/migration + RLS policy → domain rules + tests →
   API use case, and the web mock adapter with the same checks in the same order → UI → tests.**
3. Do not touch modules outside the slice. If you must, say so and explain why.
4. Architectural decisions → `docs/adr/NNNN-title.md` (context, decision, consequences).
5. A slice is not done until `CLAUDE.architecture.md` §9 (definition of done) passes.

### 2.1 Delivery loop (how work reaches `main`)

1. **Lovable** implements on branch `lovable` (it syncs both ways with GitHub).
2. The **orchestrator agent** reviews locally: typecheck, lint (0 errors), tests, node-server
   build, and real-Chrome checks in Arabic + English at 1440px and 390px for every persona.
3. A PR `lovable → main` is opened. **CI** (`.github/workflows/ci.yml`), **Codex**
   (`@codex review` after every new commit), MergePilot, CodeRabbit and Socket review it. The
   orchestrator verifies every finding and fixes the blocking ones itself on `lovable` (at most 3
   rounds per PR); non-blocking findings go to one follow-up PR after the merge. The full loop,
   with what counts as blocking, is `.claude/skills/eyadex-delivery-loop/SKILL.md`.
4. Merge with a **merge commit** (never squash or rebase pushed history — it breaks Lovable's
   sync), then fast-forward `lovable` to `main`.
5. `main` auto-deploys to Dokploy (eyadex.com, app., platform.).

## 3. Repo layout (pnpm + Turborepo workspace — do not invent new top-level folders)

```
apps/web/            the TanStack Start app (@eyadex/web): src/, public/, configs
apps/api/            the HTTP API, NestJS on Fastify (@eyadex/api): /v1/health, the error envelope, the request id
apps/worker/         the worker container, same NestJS code (@eyadex/worker): /health, graceful shutdown
packages/contracts/  Zod schemas = the single source of types (alias @eyadex/contracts/*)
packages/config/     shared TypeScript + ESLint presets (@eyadex/config)
packages/ids/        UUID v7 with injected time + entropy (@eyadex/ids)
packages/observability/ pino options + the redaction list + the request context (@eyadex/observability)
packages/db/        the only path to PostgreSQL: withTenant/withNewTenant/withNoTenant (@eyadex/db)
packages/auth/       Better Auth config + two-factor: the ONLY place sessions and passwords are handled (@eyadex/auth)
packages/secrets/    the outbox seal, the field cipher and the civil ID blind index, ADR-0028 (@eyadex/secrets)
db/sql/              SQL baseline applied to production; the only way to change a database (ADR-0024)
docs/                PRD, ADRs, specs
docker/              compose init scripts (postgres roles)
.lovable/            Lovable project metadata + plan specs for the whole repo
package.json         workspace root: turbo scripts, engines
pnpm-workspace.yaml  workspace globs, pnpm overrides, the 24h supply-chain guard
turbo.json           typecheck / lint / test / build pipeline
```

Inside `apps/web/src/`:

```
  marketing/      public landing (/ and /en), scoped .mk styles
  platform/       super-admin area
  branches/ users/ roles/ patients/ audit/ settings/   clinic area, one folder per business area
  shared/         code with NO business meaning: api client + mock, i18n, permissions, shell, table
  routes/         thin route files only: head() + component re-export
  components/ui/  shadcn primitives (do not edit unless necessary)
```

Banned folder names anywhere: `utils/` · `helpers/` · `common/` · `misc/` · `managers/` ·
`models/` or `services/` as a root folder.

## 4. File & function size

- Max **300 lines per file**, one React component per file.
- If a file would exceed the limit, split by responsibility, never by arbitrary line count.

### 4.1 Comments

- Comment the **why**, never the what. A comment restating the code is noise that will lie later.
- Phase B: **Arabic JSDoc is mandatory** on every exported function in `domain/**`, every method
  in `ports/**`, every event in `events/published.ts` (description + `@param` + `@returns`).
  Identifiers stay in English, spelled exactly as in the code.
- Banned: closing comments (`{/* end div */}`), `FIXME`, `HACK`, `XXX`, commented-out code.
  Use `TODO(spec)` for an open decision.
- A doc comment moves in the same commit as the code it describes.

## 5. Database rules (PostgreSQL, RLS-first)

- Every clinic-owned table has `clinic_id uuid NOT NULL`, primary key **`(clinic_id, id)`**,
  RLS **ENABLED and FORCED**, and the policy
  `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid` for USING and WITH CHECK (no clinic context = zero rows, never an error).
  The tenant root `clinics` is the only exemption (its `id` is the tenant key).
- **New table ⇒ new policy + negative isolation test, in the same PR.**
- Indexes start with `clinic_id`; index every RLS predicate and FK.
- IDs: UUID v7 generated by the application (no DB defaults). Timestamps `timestamptz` UTC,
  displayed in the clinic timezone. Bilingual names: `name_ar` / `name_en`.
- **No hard deletes** of users, branches, roles or patient files: deactivate / archive.
- Runtime database roles (PRD §4.5): `eyadex_app` (API + worker, tenant tables under RLS),
  `eyadex_auth` (identity tables only), `eyadex_platform` (platform module; **no grant on
  `patients` or patient-access audit rows**), `eyadex_dispatcher` (outbox only).
  **No runtime role has `BYPASSRLS`.** The owner role runs migrations only.
- **No runtime role has `TEMPORARY` on the database** (`db/sql/0022`): nothing creates a
  temporary object at runtime, and a temporary function could hide `set_config`. Only the
  owner role keeps it.
- Phase B: all tenant access through `withTenant(clinicId, tx => …)`; the raw Drizzle client is
  never exported. Never edit the production DB by hand outside a reviewed SQL file / migration.
- Civil ID: stored under RLS, never in logs or audit before/after values.

### 5.1 Migrations (forward-only)

- PostgreSQL **18** everywhere: production, CI (`postgres:18-alpine`) and local compose. The
  "compatible with 16" note in the headers of applied files 0001–0019 is historical; those files
  are never edited (their checksums are in the ledger).

- Never edit an applied file in `db/sql/` — add a new numbered file instead.
- `sh db/migrate.sh` applies pending files (each file + its ledger row in one
  transaction); `--status` lists applied/pending/CHANGED; `--dry-run` previews.
- `--baseline 0019` records hand-applied files without running them (once, for
  databases that predate the runner). A changed file blocks apply until fixed.
- Production is applied by the orchestrator over SSH, never by the app at startup.
- Every new clinic table still needs its policy + negative isolation test.

## 6. API rules (Phase B; the mock adapter mirrors them today)

- Contracts in Zod; controllers validate with them; frontends import the types.
- REST under `/v1`, cursor pagination, error envelope `{ code, message_ar, message_en, details? }`.
- Authorization = permission string `action:resource:scope`, checked on every endpoint in this
  order: active user → clinic access (not suspended, not expired) → module enabled (feature
  flag) → role holds the permission → branch scope. Default deny. **No endpoint without a guard.**
  The code checks permissions, never role names.
- Sensitive creates (clinic, invitation, patient) accept `Idempotency-Key`.
- Cross-module side effects go through outbox events; cross-module reads through ports.
- Anything expected to exceed 200 ms (emails) is a worker job.

## 7. Frontend rules

- Every string through i18n keys (ar + en); no hardcoded text in JSX.
- Logical CSS only (`ps-`, `pe-`, `ms-`, `me-`, `start`, `end`); never left/right.
- shadcn/ui only, lucide icons, react-hook-form + Zod, TanStack Table with cursor pagination,
  TanStack Query through the `ApiClient` only.
- Hiding a button is UX, not protection: the API (or mock) must reject too.
- Browser storage is read in effects only (SSR hydration).
- Design system "Clinical Operations" for the app; the marketing site has its own scoped `.mk`
  layer (`.lovable/plan/marketing-landing.md`).

## 8. Security

- Better Auth (Phase B) for sessions; TOTP mandatory for platform accounts. No hand-written
  password, token or session code.
- Invitation tokens: random, single-use, 7-day expiry, stored as a **hash**; never in audit
  snapshots, logs or URLs other than the invite link itself.
- The platform (Eyadex team) **never** sees patient data on any screen, list, log or export —
  enforced by database grants, not only UI.
- Secrets only via env (`.env.example` kept updated). Never commit `.env`, keys, passwords or
  real patient data. Production secrets live only in Dokploy.
- **Never put a secret, token, password or real phone number in a comment, test or example.**
- Append-only audit log for every administrative change and every patient-file open.

## 9. Testing (required to merge)

- Web (mock adapter): vitest against the mock adapter for every business rule of the slice;
  typecheck, lint, build in CI.
- Database (now): `db/tests/rls-isolation.sql` runs in CI (`db` job) on a fresh PostgreSQL with
  the whole `db/sql` baseline. **Every new clinic table must be added to its table list and seed
  in the same PR.** It also runs on production after every baseline change (it rolls back).
- API and worker: unit tests for pure domain functions; integration tests per use case against real
  PostgreSQL, connected as the runtime role that use case runs as: `eyadex_app` for tenant paths,
  `eyadex_platform` for platform paths (the platform module, the worker's cross-clinic scans),
  `eyadex_auth` for Better Auth, `eyadex_dispatcher` for the outbox and the retention purge (the
  owner role only sets a test up and cleans it up); **RLS negative tests for every tenant table**
  (cross-clinic read = 0 rows, write = error); the mandatory list in PRD §6.3.

## 10. Git & delivery

- Conventional commits (`feat(users): …`). One slice per PR.
- CI order: typecheck → lint → test → build (node-server preset).
- Deploy: Dokploy on the shared server, Traefik + Let's Encrypt, auto-deploy from `main`
  using the root `Dockerfile` (`NITRO_PRESET=node-server`). Postgres and Redis are Dokploy
  services on `dokploy-network`, never exposed publicly.
- Commit attribution line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 11. Things an agent must never do

- Enable Lovable Cloud or Supabase, or add a database call to the frontend.
- Use `left/right` CSS, hardcoded strings, role-name checks, hard deletes, or the word "كاشير".
- Show patient data to the platform area, or put a token/secret in audit, logs or code.
- Create a tenant table without RLS + its negative test in the same PR.
- Force-push, rebase or squash pushed history on `lovable` or `main`. (Only the `staging` deploy branch
  may move back, with `--force-with-lease`, for a rollback — ADR-0021, owner decision 2026-10-09.)
- "Refactor everything" or reformat unrelated files in a slice PR.
- Guess a business rule — ask, or mark `TODO(spec)` and stop.

## 12. Useful commands

All commands run from the repository root (pnpm + Turborepo).

`pnpm install` · `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm test` ·
`NITRO_PRESET=node-server pnpm build` · `pnpm format` · `docker compose up -d --build`

Single package: `pnpm --filter @eyadex/web <script>`.
