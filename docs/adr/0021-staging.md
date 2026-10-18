# ADR-0021 — Staging environment

- Status: accepted (PRD §5.5 item 12, §4.14, §4.15)
- Date: 2026-10-08

## Context

Every change has gone from a pull request straight to production. PRD §5.5 item 12 asks for a staging
environment where a tested `main` runs against a real API, worker, PostgreSQL and Redis — with real
email — before production gets it. The owner decided the shape on 2026-10-08 (below). The code assumed one
environment in a few places: the web app found its area only from the `app.` / `platform.` prefixes, and
the session cookie names were fixed.

## Decision

### Owner decisions (2026-10-08)

- Staging runs on the production Dokploy host (musalam-2), in the Dokploy project `Eyadex.com`, as
  separate services whose names end in `-staging`: web, api, worker, PostgreSQL 18 and Redis 8. It has
  its own database and its own Redis; it never connects to production's.
- Hosts: `staging-app.eyadex.com` (clinic) and `staging-platform.eyadex.com` (platform). They are one
  level deep because Cloudflare's universal certificate covers `*.eyadex.com` only. DNS is the proxied
  wildcard that already resolves. The API is served on both hosts under `/api` with the path stripped,
  exactly like production (ADR-0004, ADR-0007).
- The staging web is built with `VITE_API_MODE=http`.
- Staging deploys from the git branch `staging`, never from `main`.
- Staging sends real email through Resend, with its own API key and a staging sender identity.
- Every staging secret is generated fresh and pasted by the owner; nothing reuses or references a
  production value.

### Host and cookie isolation

Four layers keep a staging session from ever being valid on production, and the reverse:

1. **Hosts.** The API resolves the area only from an exact match of `APP_URL` / `PLATFORM_URL`
   (`AreaHosts`, ADR-0004). A staging API answers 404 on `app.eyadex.com`, and a production API answers 404
   on `staging-app.eyadex.com` (`area-hosts.spec.ts`, `staging-isolation.db.spec.ts`). Cookies are
   host-only (no `Domain`), so a browser never sends one host's cookie to another.
2. **Cookie names.** `AUTH_COOKIE_PREFIX` (API) sets the environment's prefix; the cookie prefix is
   `<prefix>-<area>`. Unset keeps production's names unchanged (`__Secure-eyadex-clinic.session_token`);
   staging sets `eyadex-staging` (`__Secure-eyadex-staging-clinic.session_token`). The prefix is checked
   (lowercase words joined by hyphens, at most 32 characters) before any pool opens, and the auth rate
   limiter reads the pending `two_factor` cookie under the same prefix, so staging keeps its per-subject
   second-factor limit. A test signs in on staging and replays the cookie on a production app that shares
   the same database and secret: refused.
3. **Secrets.** Staging has its own `BETTER_AUTH_SECRET`, so a production cookie never verifies there.
4. **Data.** Staging has its own database: a production session token does not exist in it.

The web build reads two new build arguments, `VITE_APP_HOST` and `VITE_PLATFORM_HOST`. Empty (production,
local development, the Lovable preview), the existing host-prefix rules apply unchanged. Set, only those
two exact host names are areas: a staging build treats `app.eyadex.com` as no area at all, and the
"wrong host" page links to the configured other host. Both or neither must be set; a broken pair fails
the server at start rather than guessing.

### Security headers

Production sent no security header of its own. The API now adds `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'` and `Cache-Control: no-store` to every answer, including the errors Fastify
raises before Nest. The web server adds `nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`
everywhere; in an `http` build it also refuses framing (`X-Frame-Options: DENY`,
`frame-ancestors 'none'`, plus `base-uri 'self'; object-src 'none'`), because that is where real session
cookies exist, while the mock build is what the Lovable editor shows in its own frame. Area hosts —
`app.`, `platform.` and every configured host — also get `X-Robots-Tag: noindex, nofollow`; the
marketing host stays indexable. No script policy yet: SSR hydration runs inline scripts without nonces.
HSTS is left to Cloudflare. CORS stays absent: every call is same-origin (ADR-0004).

### What stays hard-coded, on purpose

- The marketing `SITE.url`, canonical links, `robots.txt` and `sitemap.xml` keep `https://eyadex.com`:
  staging must point search engines at production, and its area hosts are `noindex`.
- The clinic slug preview `<slug>.eyadex.com` describes production addresses.
- Invitation links are built from `APP_URL` in the worker (env) and from the current origin on the clinic
  host in the web; the platform's first-admin link has no token in HTTP mode. No change needed.
- Reserved slugs: `staging`, `staging-app` and `staging-platform` are reserved (PRD §4.15; the last two
  by owner decision 2026-10-09), so no clinic can claim a staging host name once clinic subdomains
  (`{slug}.eyadex.com`) ship.

### Environment matrix (names only; values in `.env.example` and the runbook)

| Variable                                | web (build arg) | api | worker | Secret |
| --------------------------------------- | :-------------: | :-: | :----: | :----: |
| `VITE_API_MODE`                         |        ✓        |     |        |        |
| `VITE_APP_HOST`, `VITE_PLATFORM_HOST`   |        ✓        |     |        |        |
| `APP_URL`                               |                 |  ✓  |   ✓    |        |
| `PLATFORM_URL`                          |                 |  ✓  |        |        |
| `TRUST_PROXY_HOPS`                      |                 |  ✓  |        |        |
| `AUTH_COOKIE_PREFIX`                    |                 |  ✓  |        |        |
| `LOG_LEVEL`                             |                 |  ✓  |   ✓    |        |
| `DATABASE_URL` (`eyadex_app`)           |                 |  ✓  |   ✓    |   ✓    |
| `AUTH_DATABASE_URL` (`eyadex_auth`)     |                 |  ✓  |        |   ✓    |
| `PLATFORM_DATABASE_URL`                 |                 |  ✓  |        |   ✓    |
| `DISPATCHER_DATABASE_URL`               |                 |     |   ✓    |   ✓    |
| `REDIS_URL`                             |                 |  ✓  |        |   ✓    |
| `BETTER_AUTH_SECRET`                    |                 |  ✓  |        |   ✓    |
| `OUTBOX_SEAL_KEY` (same in api, worker) |                 |  ✓  |   ✓    |   ✓    |
| `MAIL_PROVIDER_SEAL_KEY` (same)         |                 |  ✓  |   ✓    |   ✓    |
| `RESEND_API_KEY`                        |                 |     |   ✓    |   ✓    |
| `MAIL_FROM`                             |                 |     |   ✓    |        |
| `SMTP_HOST` / `_PORT` / `_USER`         |                 |     |   ✓    |        |
| `SMTP_PASSWORD`                         |                 |     |   ✓    |   ✓    |
| `OUTBOX_POLL_INTERVAL_MS`               |                 |     |   ✓    |        |
| `RETENTION_PURGE_INTERVAL_MS` (opt.)    |                 |     |   ✓    |        |

The PostgreSQL service also holds the owner password and the four runtime role passwords; the Redis
service holds its password.

### Deploy flow

- Each of the three applications deploys the branch `staging` with Dokploy auto-deploy. Nothing deploys
  `staging` but those services, and `main` keeps deploying production.
- **Promotion** = fast-forward `staging` to a `main` SHA whose CI is green:
  `git push origin <sha>:refs/heads/staging` (refused unless it is a fast-forward). Promote only SHAs
  that are on `main`; the branch carries no commits of its own.
- **Pre-merge check (owner decision 2026-10-18).** A pull request's merge candidate may also be promoted, so that every slice is tried against the real API before it merges. Rules:
  - its CI is green, and its head contains the SHA staging runs, so the push is still a fast-forward;
  - after the PR merges, promote its merge commit on `main`;
  - before the merge, staging gets only the PR's migrations that the release order puts before the deploy (additive ones); destructive ones wait for the merge commit;
  - a new head after the check is promoted again; if the PR is dropped, or a new head no longer contains the SHA staging runs, restore the pre-migration dump when the PR's SQL was applied, then move `staging` back to a `main` SHA with `--force-with-lease` (runbook §12), so the schema and the ledger match `main` again;
  - once staging has applied a PR's `db/sql` file, that file is frozen: a later fix is a new numbered file, because the ledger would flag the changed checksum.
- **Migrations** run on the staging database with the same `db/migrate.sh`, by the orchestrator, before
  the new containers start (CLAUDE.md §5.1): `--status`, `--dry-run`, apply, `--status`, then
  `db/tests/*.sql`. Staging gets every migration first; production follows after staging has run it.
- **Backups:** a daily Dokploy backup of the staging database, and a `pg_dump -Fc` before every
  migration, like production.
- Staging holds synthetic data only — never a real patient, phone number or civil ID.

### First platform account on a fresh database

Nothing in the repository created a platform account before this slice, and neither the repository nor
the orchestration handoff records how one would be made. There is no sign-up (PRD §4.10), so
this slice adds a one-off bootstrap. `createFirstPlatformAccount` (`@eyadex/auth`) runs on the
`eyadex_auth` role:

- it refuses when any platform account exists, so it can never become a second door into the platform;
- it takes an advisory lock, so two runs at once create one account;
- it holds the email for the platform (`reserve_platform_email`, 0015) and has Better Auth write the user
  and its credential in the same transaction, on one connection: all of it commits or none of it does
  (a commit that fails leaves no account without its hold), and a rerun works;
- it refuses an email that has an account or a hold anywhere.

The API image runs it as `dist/bootstrap-platform-account.js`, with the container's own auth settings,
`BOOTSTRAP_EMAIL` / `BOOTSTRAP_NAME` from `docker exec -e`, and the password on stdin only (never an
argument or a variable). The first sign-in on the platform host must enrol TOTP (ADR-0004).
The bootstrap writes a `platform_account.bootstrapped` platform audit row in the same transaction
(owner decision 2026-10-09, SQL 0039): `link_first_platform_account` now takes the row's id from the
app (UUID v7) and inserts it itself, so no first account can be linked without its audit row. The
row holds the account id and status only: no email or name, which are typed text the function cannot
scrub (Codex review). Databases bootstrapped before 0039 (staging, production) get the row once from
0039 itself, for every active member nobody invited, marked `backfilled: true` and dated when the
account joined (Codex review).

### Rollback

- **Code:** redeploy the previous deployment of the affected service in Dokploy, or move `staging` back
  to the previous SHA and redeploy. Moving the branch back is a non-fast-forward push. It is allowed on
  `staging` only, with `git push --force-with-lease` (owner decision 2026-10-09), because the branch is a
  deploy pointer that Lovable never syncs; `main` and `lovable` are never force-pushed (CLAUDE.md §11).
- **Schema:** migrations are forward-only. A bad migration is fixed by a new file; if staging data is
  damaged, restore the pre-migration dump or recreate the database (it holds synthetic data only).
- **Secrets:** rotating `BETTER_AUTH_SECRET` signs everyone out; `OUTBOX_SEAL_KEY` and
  `MAIL_PROVIDER_SEAL_KEY` change in the api and the worker together (ADR-0015).

## Consequences

- `docs/specs/staging-runbook.md` is the step-by-step for the orchestrator; `docker/smoke-test.sh`
  checks a deployed host pair with anonymous requests only.
- Production behaviour is unchanged except for the new response headers: the cookie names, the area
  rules and every default are the same when the new variables are unset. When production switches to
  `VITE_API_MODE=http`, its web pages start refusing to be framed.
- Staging and production share one host's CPU, memory and disk; the staging services get tighter memory
  limits so a runaway staging container cannot starve production.
