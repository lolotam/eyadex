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

## Architecture rules
- The product brand is `Eyadex` in both languages and its domain is `eyadex.com`; `clinic` remains the business-domain term in code and URLs.
- Frontend only: no Lovable Cloud, no database, no server functions with business logic — a separate backend API comes later.
- All data goes through the `ApiClient` interface (`src/shared/api/api-client.ts`) via `useApi()`; screens never import the mock adapter — so the adapter can be swapped for HTTP.
- Zod schemas in top-level `contracts/` (alias `@contracts/*`) are the single source of types for forms and the API client.
- Folders are named after the business (`src/platform`, `src/branches`, `src/users`, `src/roles`, `src/patients`, `src/audit`, `src/settings`, `src/shared`); never `utils/helpers/common/misc/services/models` — keeps the domain readable.
- Route files are thin: head() + component re-export only — pages live in business folders.
- UI visibility is driven by permission strings `action:resource:scope` via `can()`, never by role names — roles are user-editable.
- All UI text goes through i18n keys (`src/shared/i18n`); use logical CSS (ps/pe/ms/me/start/end) only — Arabic RTL is the default.
- Browser storage (persona, language, mock DB) is read in effects only — avoids SSR hydration mismatches.
- `db/sql/*.sql` is documentation only and is never executed.
- One component per file, max 300 lines per file.
- The visual system uses flat clinical surfaces, compact 8px-or-less radii, thin borders, and semantic tokens; deep teal is reserved for actions, active states, and focus — keeping dense administration screens calm and scannable.
- Marketing site (/ and /en, src/marketing, scoped .mk styles): follow .lovable/plan/marketing-landing.md.
- Eyadex serves every clinic specialty with one shared core; specialty-specific sections are roadmap additions, and the default front-desk role key is `receptionist`.
