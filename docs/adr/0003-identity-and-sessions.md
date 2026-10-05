# ADR-0003 — Identity and sessions (Better Auth)

- Status: accepted (Phase B slice 2a)
- Date: 2026-10-04

## Context

PRD §4.10 fixes the decisions: Better Auth with email + password, sessions in PostgreSQL behind an
httpOnly cookie, no self sign-up, TOTP mandatory for platform accounts, deactivation ends sessions
immediately, and separate sessions for `app.` and `platform.` (§4.15). PRD §4.5 reserves the
`eyadex_auth` role for Better Auth alone. CLAUDE.md §8 forbids hand-written password, token or
session code.

## Decision

- **Package.** `packages/auth` (`@eyadex/auth`) is the only place Better Auth is configured.
  `createAuth({ area, databaseUrl, secret, baseUrl, ids })` returns the instance, two server-side
  helpers (`createUserAccount`, `revokeUserSessions`) and `close()`. Version `better-auth@1.7.7`,
  pinned exactly and older than the 24-hour supply-chain guard.
- **Role.** Better Auth has its own postgres.js pool, and the factory refuses a URL whose user is
  not `eyadex_auth`. This is a named exception to ADR-0002's "no raw client": the auth tables are
  not clinic tables, so there is no `app.clinic_id` to set, and Better Auth needs its own adapter.
- **Tables.** `db/sql/0023` adds `auth_users`, `auth_sessions`, `auth_accounts`,
  `auth_verifications` and `auth_two_factors`: snake_case columns, `uuid` primary keys with no
  database default, `timestamptz` times, and no database defaults at all (Better Auth supplies them).
  They are global identity tables, so they have no `clinic_id` and no RLS. Isolation comes from grants:
  `eyadex_auth` gets `SELECT, INSERT, UPDATE` on users and `SELECT, INSERT, UPDATE, DELETE` on the
  rest (sign-out, revocation, expiry, disabling 2FA); no `DELETE` on users (no hard deletes). The
  other runtime roles get nothing (`db/tests/auth-tables.sql`). The Drizzle mirror is
  `packages/db/src/schema/auth.ts` and is checked by the drift test.
- **One two-factor row per user.** `auth_two_factors.user_id` is `UNIQUE`: Better Auth enrolls with
  an unguarded read-then-insert, so overlapping first enrollments could otherwise store two secrets.
  The loser gets a unique violation; the winner's QR code is the stored row. Known limit: two
  overlapping re-enrollments of a still-unverified row both succeed and the last update wins, so
  one returned QR code cannot verify. Two-factor stays off until a code verifies, so the user just
  enrolls again — no lockout and no leak. **Slice 2b must serialize `/two-factor/enable` per user**
  (a per-user advisory lock around the handler) when it mounts the routes.
- **Ids.** Better Auth's `advanced.database.generateId` returns UUID v7 from `@eyadex/ids`.
- **Sign-up.** `emailAndPassword.disableSignUp: true`; the public endpoint refuses. Users are created
  only through `createUserAccount`, which hashes with Better Auth's own hasher and writes the user and
  its credential account through Better Auth's internal adapter.
- **Two cookies.** `advanced.cookiePrefix` is `eyadex-platform` or `eyadex-clinic`, cookies are
  host-only (no cross-subdomain option) and secure on https, so the areas never share a session.
- **Area-bound sessions.** Both areas share `auth_sessions` and one `BETTER_AUTH_SECRET` (it also
  encrypts the per-user TOTP secret, so it cannot be split per area). A clinic cookie copied under
  the platform cookie name would therefore verify. Each session row records `area`, and
  `EyadexAuth.getSession` returns `null` for a session from the other area. **Slice 2b guards must
  use it**, and must refuse other-area sessions on every Better Auth route that reads a session.
- **Role guard covers the URL query.** postgres.js sends unknown URL parameters in the startup
  message after `user`, so `?user=eyadex_owner` would log in as the owner; only `sslmode` is allowed.
  The `.env.example` placeholder secret is refused.
- **Sessions.** Database sessions only, cookie cache off: `revokeUserSessions` deletes every row and
  the next request has no session.
- **Two-factor.** The two-factor plugin is configured for every area; making it mandatory on the
  platform host is wired with the HTTP routes (slice 2b).
- **No foreign key from `memberships.user_id` to `auth_users`.** The tables belong to different roles:
  `eyadex_app` has no privilege on `auth_users`, and a foreign key would make every membership write
  check a table that role must never read, and it would couple clinic data to the identity store.
  The link is kept by the identity use cases, which create both rows.

## Consequences

- One `createAuth` per area in the API (slice 2b mounts the handlers per host).
- A secret shorter than 32 characters, an unknown area or a non-`eyadex_auth` URL fails at startup.
- Open (`TODO(spec)`): the password policy beyond Better Auth's 8–128 default; writing the user and
  the credential row in one transaction together with the global email hold (`0015`), owned by the
  invitation-acceptance use case; Redis-backed rate limiting (PRD §4.10) arrives with the HTTP routes.
