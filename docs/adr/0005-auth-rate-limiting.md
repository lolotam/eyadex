# ADR-0005 — Auth rate limiting in Redis

- Status: accepted (Phase B slice 2c)
- Date: 2026-10-05

## Context

PRD §4.10 asks for sign-in and recovery attempts to be limited in Redis. The API may run as several
replicas, so an in-process counter would allow N times the limit.

## Decision

- **Where.** `identity/auth/auth-handler.ts` counts each limited request in Redis BEFORE forwarding it to
  Better Auth (after host, allowlist, foreign-session and the platform TOTP gate). Over the limit → 429
  `rate_limited` with `Retry-After`; Better Auth is not called.
- **Counter.** Fixed window per key: one Lua script does `INCR`, starts the window with `PEXPIRE` on the
  first hit and returns `PTTL` (atomic; a key never lives without an expiry).
- **Limits** (`auth-rate-limits.ts`, `TODO(spec)`: the PRD gives no numbers), per area:
  - `POST /auth/sign-in/email`: per client IP 20 / 10 min, and per email (trim + lowercase) 5 / 15 min.
  - `POST /auth/two-factor/verify-totp` and `/verify-backup-code`: per client IP 20 / 10 min, and per
    subject 5 / 5 min — the session's user id, else the area's pending `two_factor` cookie.
  - `POST /auth/change-password` and `/auth/two-factor/enable`: per user 5 / 15 min.
- **No personal data in keys.** `eyadex:rl:<area>:<route>:<dimension>:<HMAC-SHA256(BETTER_AUTH_SECRET,
  value) hex>`. The client IP comes only from `AreaHosts.clientIp` (ADR-0004); when the proxy chain is not
  the deployed one, those requests share a single `untrusted` bucket.
- **Fail closed.** If Redis errors or is unreachable (no offline queue, no command retry, 1 s timeout),
  the limited routes answer 503 with the `unknown` envelope and the error is logged sanitised. Routes
  without a limit (sign-out, get-session) keep working.
- **Better Auth's limiter is off** (`rateLimit: { enabled: false }` in `createAuth`): it is in-memory per
  process, so it neither works across replicas nor matches these keys.
- `REDIS_URL` is validated with the other auth settings, only when auth is mounted; the connection is
  closed on shutdown.

## Consequences

- A Redis outage blocks sign-in and two-factor until it is back — chosen over a silent bypass.
- Attempts are counted whether they succeed or fail; a user who signs in 5 times in 15 minutes waits.
- Rotating `BETTER_AUTH_SECRET` resets every counter (new HMAC keys).
