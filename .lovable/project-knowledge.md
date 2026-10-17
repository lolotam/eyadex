# Eyadex — Project Knowledge (paste into Lovable → Project settings → Knowledge)

Source of truth: this file in the repo (`.lovable/project-knowledge.md`). Updated 2026-10-17; it replaces the Phase A knowledge.

## Read before every task, in this order

1. `.lovable/review-lessons.md` — the mistakes reviewers found in earlier slices, and the checklist you tick before reporting done. **Mandatory, every task.**
2. The brief you were sent, and every file its "Read first" section names.
3. `CLAUDE.md`, `CLAUDE.architecture.md`, `AGENTS.md`, and the spec for the slice under `docs/specs/`.
   If any of these disagree with this knowledge, the repo files win.

## What Eyadex is

Multi-tenant clinic-management SaaS for every clinic specialty, Kuwait first. Arabic-first (RTL) with English. Brand: `Eyadex` in Latin letters in both languages; domain eyadex.com (app., platform., api.). Users: the platform team (never sees patient data), clinic admins, and clinic staff with custom roles. Patients are records, not app users.

## Vocabulary (binding in UI copy)

- Arabic UI says «المراجع / المراجعون», never «المريض / المرضى». English app UI says "Patients". Code identifiers stay `patients`.
- The front-desk role is «موظف استقبال / Receptionist» (key `receptionist`). The words «كاشير» and "Cashier" must not appear anywhere.

## The system today (Phase B)

- pnpm + Turborepo monorepo: `apps/web` (TanStack Start, yours), `apps/api` + `apps/worker` (NestJS on Fastify), `packages/contracts` (Zod, alias `@eyadex/contracts/*`), `packages/db`, `db/sql` (PostgreSQL 18 with forced Row-Level Security).
- Built modules: branches, users and invitations, roles, patients, appointments and schedules, visits and medical files, services, email and WhatsApp notifications, settings, platform area, audit log, marketing site.
- In progress: finance F1 (service prices and invoices) is on branch `lovable` and reaches `main` with PR #78. Build on it only when the brief says so.
- The web talks to data only through the `ApiClient` interface via `useApi()`. `VITE_API_MODE` picks the in-memory mock (default; preview and tests) or the HTTP adapter (production). Screens never import an adapter.
- The mock must behave exactly like the API: same checks, same check order, same errors, same audit rows. See review-lessons §2.
- Change only `apps/web` and its tests unless the brief says otherwise. The only other files you may edit are your own: the "Quick rules (Lovable-maintained)" section of `AGENTS.md`, your plan files under `.lovable/plan/`, and `roadmap.md`. Never touch `apps/api`, `apps/worker`, `packages/*` (contracts included) or `db/sql`; if a screen needs a contract change, ask for it in your plan.

## Hard limits (stop and ask if a request would break one)

- No Lovable Cloud, no Supabase, no database, auth provider, storage bucket, edge function or secret in Lovable.
- No server functions with business logic.
- Never commit secrets, tokens, real phone numbers or real patient data, including in tests.
- Never rewrite pushed git history.

## Permissions (drive every UI decision from them, never from role names)

- Format `action:resource:scope`. Scopes: `clinic` (all branches), `branch` (the user's branch list), `own` (the user's own records, across branches).
- Default deny. Check order: active user → clinic access (not suspended, not expired) → module enabled → permission → branch scope → patient reach when a patient is named.
- **Gate every action by the record's branch, not by the verb alone, and take a form's branch list from that form's action permission.** This is the most common review finding; read review-lessons §1.
- Hiding a button is UX; the mock rejects too. A forbidden URL shows the "not allowed" page.

## Domain rules that always hold

- Clinic → Branch, two levels. One role per user plus a branch list or all branches.
- No hard deletes: deactivate users, branches, roles; archive patients.
- The last active clinic admin and the last active branch cannot be deactivated.
- Subscription access needs a non-suspended status and a future expiry, decided by the server clock, never the device clock.
- Every date shown or picked is a calendar day in the clinic's time zone.
- Every administrative change and every patient-file open writes an append-only audit row. Civil ID, tokens and secrets never go into audit values. Typed names and other allowed text go in only after `scrubAuditText` / `scrubAuditValue` from `@eyadex/observability/audit-text`, as the API does; leave out whatever the spec keeps out (for example a discount reason).
- The platform area never shows patient data on any screen, list, log or export.

## Code rules

- Business-named folders under `apps/web/src/` (appointments, invoices, patients, …). `shared/` is for code with no business meaning only. Banned names: utils, helpers, common, misc, models.
- Route files are thin: `head()` plus a re-export.
- One component per file, max 300 lines per file.
- Every string through i18n keys in ar and en. Logical CSS only (ps, pe, ms, me, start, end).
- shadcn/ui, lucide icons, react-hook-form + Zod, TanStack Query and Table (cursor pagination). No other component library.
- Browser storage is read in effects only.
- Every rule gets a vitest test that fails without it.

## Design system "Clinical Operations"

Warm off-white canvas, white flat surfaces, thin borders, radius 8px or less, almost no shadows. Deep teal only for primary actions, active navigation and focus. IBM Plex Sans Arabic / IBM Plex Sans. Fixed sidebar, quiet header. Dense tables with one toolbar and row actions at the end. Status is icon + label + tint, never color alone. Single-column forms; create and edit open in a dialog. Every screen has loading, empty **and error-with-retry** states. Do not change global tokens unless asked. The marketing site has its own scoped `.mk` layer (`.lovable/plan/marketing-landing.md`).

## How to work a task

1. Start in Plan mode. In the plan, list every product rule the brief leaves open as a question. Do not guess.
2. Build only the slice in the brief. A slice is one story, about 3,000 changed lines; if yours grows past that, stop and say so.
3. Before reporting done: tick every line of the checklist in `.lovable/review-lessons.md`, run typecheck, lint and tests, check the preview, and check the screens in Arabic and English at 1440px and 390px.
4. Report: what you built, which personas can see and do what, which checklist lines needed work, and any open question. Then stop and wait for review.
