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
- **Origin check.** `trustedOrigins` is the area origin only, and `disableOriginCheck: false` is set
  explicitly: Better Auth otherwise skips the check when `NODE_ENV` is `test`.

## Consequences

- The proxy must strip `/api` and forward the original Host (or set `TRUST_PROXY_HOPS`).
- TODO(spec): Redis rate limiting (PRD §4.10), membership deactivation and subscription checks in the
  guards, and invitation acceptance arrive with slice 2c.
