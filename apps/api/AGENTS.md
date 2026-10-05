# apps/api rules

- Modules live in `src/modules/<module>/` (domain, ports, persistence, queries, `<module>.module.ts`, `index.ts`); persistence uses only `@eyadex/db` wrappers with bound `sql` — so tenant isolation and the import arrows stay checkable.
- A module reads another module's tables only through a port it defines and the owner implements (tenancy's `SeatUsageReader` ← identity's `PgSeatUsageReader`); allowed arrows are in CLAUDE.architecture.md §2.2.
- Every module imports `DatabaseModule` (one pool, closed on shutdown) — never its own `databaseProvider`.
- `tx.execute` cannot bind a `Date` (postgres.js `unsafe()` sends parameters as text): bind `date.toISOString()` with `::timestamptz`.
- Auth is same-origin per area (ADR-0004): `/auth/*` is an allowlist in `identity/auth/auth-routes.ts`, the area comes only from `AreaHosts.resolve`, and `/v1` routes use `SessionGuard` (area-bound `EyadexAuth.getSession`, never `auth.api.getSession`) — so cookies never cross areas and new Better Auth routes stay closed by default.
- Limited auth routes are counted in Redis by `identity/auth/rate-limiter.ts` before Better Auth is called, with limits only in `auth-rate-limits.ts`, HMAC keys and fail-closed on Redis errors (ADR-0005) — so limits hold across replicas and keys never carry personal data.
