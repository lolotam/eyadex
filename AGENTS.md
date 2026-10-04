<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# AGENTS.md — entry point for Codex, Lovable and every other agent

Read these files fully, in this order, before any task or any review:

1. [`CLAUDE.md`](./CLAUDE.md) — day-to-day rules (workflow, delivery loop, DB, API, security, testing)
2. [`CLAUDE.architecture.md`](./CLAUDE.architecture.md) — where code goes and what it may import
3. [`docs/PRD-Eyadex-MVP.md`](./docs/PRD-Eyadex-MVP.md) — product scope, user stories, decisions
4. [`.lovable/plan/marketing-landing.md`](./.lovable/plan/marketing-landing.md) — marketing site spec

The names say "CLAUDE", but the rules apply to every agent equally.

## Review guidelines

When reviewing a pull request, report only real defects, ranked by severity. Check first:

- patient data reachable from the platform area, the platform API or the `eyadex_platform` DB role
- a clinic table without forced RLS and a negative isolation test in the same PR
- a token, secret, password or real phone number in code, tests, logs or audit snapshots
- a mock or API method that skips the permission check order (`CLAUDE.architecture.md` §3)
- a screen importing `apps/web/src/shared/api/mock/*`, or business logic inside a React component
- hardcoded UI strings, left/right CSS, checks on role names instead of permissions, hard deletes
- the word "كاشير"/"Cashier", or "المريض/المرضى" in Arabic UI copy (use "المراجع/المراجعون")

## Quick rules (Lovable-maintained)

- The product brand is `Eyadex` in both languages and its domain is `eyadex.com`; `clinic` remains the business-domain term in code and URLs.
- Frontend only: no Lovable Cloud, no database, no server functions with business logic — a separate backend API comes later.
- All data goes through the `ApiClient` interface (`apps/web/src/shared/api/api-client.ts`) via `useApi()`; screens never import the mock adapter — so the adapter can be swapped for HTTP.
- Zod schemas in `packages/contracts` (alias `@eyadex/contracts/*`) are the single source of types for forms and the API client.
- Folders are named after the business (`apps/web/src/platform`, `branches`, `users`, `roles`, `patients`, `audit`, `settings`, `shared`); never `utils/helpers/common/misc/services/models` — keeps the domain readable.
- Route files are thin: head() + component re-export only — pages live in business folders.
- UI visibility is driven by permission strings `action:resource:scope` via `can()`, never by role names — roles are user-editable.
- All UI text goes through i18n keys (`apps/web/src/shared/i18n`); use logical CSS (ps/pe/ms/me/start/end) only — Arabic RTL is the default.
- Browser storage (persona, language, mock DB) is read in effects only — avoids SSR hydration mismatches.
- `db/sql/*.sql` is the SQL baseline applied to the production database (2026-10-03); every schema change adds or edits a file here in the same PR, and is applied by the orchestrator after review. Phase B replaces it with Drizzle migrations starting from this state.
- One component per file, max 300 lines per file.
- The visual system uses flat clinical surfaces, compact 8px-or-less radii, thin borders, and semantic tokens; deep teal is reserved for actions, active states, and focus — keeping dense administration screens calm and scannable.
- Marketing site (/ and /en, apps/web/src/marketing, scoped .mk styles): follow .lovable/plan/marketing-landing.md.
- Eyadex serves every clinic specialty with one shared core; specialty-specific sections are roadmap additions, and the default front-desk role key is `receptionist`.
- Mock rules live in `apps/web/src/shared/api/mock/`: `mock-actor.ts` resolves the signed-in account and applies the permission check order, `mock-audit.ts` is the only clinic audit writer — so every namespace enforces the same rules.
- A persona may pin an exact clinic account (`memberId`); a deactivated account makes every request fail with `account_disabled`, and the clinic shell sends the user to sign-in — sessions end on deactivation.
- Role permission keys are always read live from the role (no copies on accounts), and saving a role keeps keys of switched-off modules untouched — so module toggles and role edits take effect immediately and reversibly.
- Patients branch scope hides out-of-scope files as `not_found` and patient audit snapshots use an explicit field allowlist (no civil ID) — so files can't be probed and sensitive IDs never reach the log.
- Platform accounts and platform settings live in the mock store; every platform-console call resolves the signed-in platform account first (`mock-platform-actor.ts`, which also holds the single platform audit writer) — so platform deactivation ends sessions and actor names are real.
- The platform audit API builds its rows from platform events plus clinic entries that are administrative and not about a patient, filtered at the source — so patient activity can never reach the platform, whatever the UI asks.
- The Drizzle schema in `packages/db/src/schema` mirrors `db/sql` and is checked by `schema-drift.db.spec.ts`; `db/sql` stays the source of truth until the switchover — so the two can never silently diverge.
