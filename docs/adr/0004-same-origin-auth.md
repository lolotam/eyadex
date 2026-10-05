# ADR-0004 — Same-origin auth per area

- Status: accepted (Phase B slice 2b)
- Date: 2026-10-05

## Context

PRD §4.15: the clinic (`app.`) and platform (`platform.`) areas never share a session cookie. If browsers
called `api.eyadex.com` directly, both areas' cookies would be stored for one host and sent together.

## Decision

- **Same origin.** Each area calls the API on its own host: `https://app.eyadex.com/api/*` and
  `https://platform.eyadex.com/api/*`. The reverse proxy (configured by the orchestrator, not in this repo)
  routes both to the api container and strips `/api`. Cookies stay host-only (no `Domain`), `Secure` with
  the `__Secure-` prefix on https.
- **Area from Host.** `APP_URL` and `PLATFORM_URL` are validated at startup (absolute http/https, distinct
  hosts). `AreaHosts.resolve` matches the request host EXACTLY (case-insensitive, port-aware: the default
  port equals the bare host); anything else answers 404 with the error envelope. `X-Forwarded-Host` is
  ignored unless `TRUST_PROXY_HOPS` (default 0) is set; then the entry the N-th trusted proxy appended
  (counted from the right) is used, and a shorter chain is refused. `/v1/health` is host-agnostic so
  container health checks keep working.
- **basePath.** Better Auth runs with `basePath: "/api/auth"` — the path the browser sees, so every URL it
  builds is correct. Fastify serves `/auth/*` (after the proxy strip) and rebuilds the Request as
  `<area origin>/api<url>` before calling `auth.handler`.
- **Allowlist.** Only sign-in/email, sign-out, get-session, change-password and the two-factor routes
  (enable, verify-totp, disable, generate-backup-codes, verify-backup-code) are reachable, by exact method
  and path. Everything else under `/auth` is 404.
- **SessionGuard.** `/v1` routes use `EyadexAuth.getSession` of the resolved area (ADR-0003); null → 401
  `unauthorized`. The session is put on the request as `areaSession`.
- **Mandatory platform TOTP.** On the platform host, a session whose user has `twoFactorEnabled !== true`
  reaches only sign-in, sign-out, two-factor/enable and two-factor/verify-totp; every other `/auth` and
  `/v1` route → 403 `two_factor_required`.
- **Enrollment lock.** `/two-factor/enable` runs under `pg_try_advisory_lock` keyed on the user id, on one
  reserved `eyadex_auth` connection; an overlapping request gets 409 `two_factor_busy` instead of
  overwriting the secret behind the first QR code.
- **Other-area sessions on `/auth`.** Every `/auth` route first asks `isForeignSession`: a valid session
  issued by the other area (a cookie renamed across hosts) → 401 `unauthorized` before Better Auth runs,
  since Better Auth alone would accept it (ADR-0003).
- **No disabling TOTP on the platform.** `/two-factor/disable` is reachable on the clinic host only; on
  the platform host it answers 404, so a stolen session plus password cannot swap the second factor.
- **One account, one area (`0024`).** `auth_users.area` is set by the instance that creates the account,
  and `databaseHooks.session.create.before` refuses to mint a session for a user of the other area — one
  hook for sign-in, verify-totp/backup-code with the `two_factor` cookie and trusted devices. The refusal
  reads as `invalid_credentials`. A person who needs both areas holds two accounts with two emails.
- **Enrollment lock on its own pool.** The lock is a `pg_try_advisory_xact_lock` inside a transaction on
  a dedicated 3-connection pool, counted in memory before a connection is taken; when all are busy the
  answer is 409 at once. On Better Auth's own pool, a few users enrolling together held every connection
  and the whole area's sign-in hung. (`reserve()` is avoided: postgres.js 3.4.9 never resolves it on a
  pool with no open connection when `fetch_types` is false.)
- **Client IP.** Better Auth reads the IP only from `x-eyadex-client-ip`, which the API overwrites on
  every request from the socket (`TRUST_PROXY_HOPS=0`) or the address our outermost proxy appended; a
  client-sent `X-Forwarded-For` neither spoofs it nor collapses everyone into one rate-limit bucket.
- **Platform TOTP stays mandatory.** `trustDevice` is refused (400) on the platform host, and when a
  platform user completes enrollment every other session — opened with the password alone — is revoked.
- **Error envelope.** A failed Better Auth answer leaves as the catalogued envelope
  (`invalid_credentials`, `unauthorized`, `forbidden`, `rate_limited`, `validation`, `unknown`), never
  Better Auth's own body.
- **Origin check.** `trustedOrigins` is the area origin only, and `disableOriginCheck: false` is set
  explicitly: Better Auth otherwise skips the check when `NODE_ENV` is `test`.

## Consequences

- The proxy must strip `/api` and forward the original Host (or set `TRUST_PROXY_HOPS`).
- TODO(spec): Redis rate limiting (PRD §4.10), membership deactivation and subscription checks in the
  guards, and invitation acceptance arrive with slice 2c.
