# Clinic App — Phase 1 (frontend foundation)

Scope follows your brief's "Start with" line: app shell, contracts, API client + mock adapter + seed data, then Platform > Clinics screens. Then stop for review.

## Hard constraints honored
- No Lovable Cloud, no Supabase, no server functions, no secrets.
- All data through one typed `ApiClient` interface; mock adapter in memory, persisted to localStorage. Screens only see the interface (via a React context provider), so an HTTP adapter can replace it later with no screen changes.
- Mocked auth: persona switcher only.
- SQL files under `/db/sql/` as documentation only, never executed.

## What you will see
- Arabic by default (RTL), switch to English (LTR) from the header.
- Persona switcher in the header: Platform Admin, Clinic Admin, Doctor, Cashier, Technician (clinic personas also pick which clinic). Suspended/expired clinic shows a clear "cannot sign in" message.
- Platform area: sidebar with Overview, Clinics, Team, Audit log, Settings. In this phase Clinics is fully built; the others show a "coming next" page.
- Clinic area: sidebar filtered by permissions (Overview, Branches, Users, Roles, Patients, Audit, Settings, My account) — pages are placeholders this phase. Forbidden URLs show a "not allowed" page.
- Clinics screens:
  - List with search, filters (status, specialty), cursor pagination.
  - Create clinic + first admin (name ar/en, slug, specialty, default language, timezone, admin name + email).
  - Clinic page tabs: Details, Subscription & limits (trial/active/suspended, expiry by duration or date, max users/branches, usage vs limit), Modules (patients flag), Users (read-only), Branches (read-only). No patient data anywhere.

## Technical details
- Folders: `contracts/` (top-level Zod schemas = single type source), `src/shared/` (api client interface, mock adapter, seed, i18n, permissions, shell, persona), `src/platform/` (clinic pages/components), plus empty-ready `src/branches`, `src/users`, `src/roles`, `src/patients`, `src/audit`, `src/settings`. No banned folder names. One component per file, max 300 lines.
- Routes in `src/routes/` are thin re-exports: `/` (persona landing), `/platform/*`, `/clinic/*`, `/forbidden`.
- Permissions: `action:resource:scope` strings; UI checks permissions, never role names. Seeded roles per clinic: Clinic Admin (locked), Doctor, Cashier, Technician.
- Mock enforces: no hard deletes, limits on users/branches, last active Clinic Admin protection, unique patient phone per clinic, module-off calls rejected, unique slug.
- Seed (deterministic, built lazily): 3 clinics x 2 branches x 5 users x 20 patients.
- Stack: react-hook-form + Zod, TanStack Table + Query, shadcn/ui, lucide. i18n via a small typed dictionary (ar/en), logical CSS only (ps/pe/ms/me/start/end).
- SQL docs: `db/sql/0001_clinics.sql` … `0012_platform_audit_log.sql` per your rules (clinic_id PK prefix, RLS enabled+forced with `app.clinic_id` policy, uuid without default, timestamptz, name_ar/name_en, no user/session tables).
- Design: calm clinical look — warm off-white, deep teal primary, IBM Plex Sans Arabic + IBM Plex Sans.
- Record architecture rules in `AGENTS.md`.
