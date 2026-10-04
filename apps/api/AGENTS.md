# apps/api rules

- Modules live in `src/modules/<module>/` (domain, ports, persistence, queries, `<module>.module.ts`, `index.ts`); persistence uses only `@eyadex/db` wrappers with bound `sql` — so tenant isolation and the import arrows stay checkable.
- A module reads another module's tables only through a port it defines and the owner implements (tenancy's `SeatUsageReader` ← identity's `PgSeatUsageReader`); allowed arrows are in CLAUDE.architecture.md §2.2.
- Every module imports `DatabaseModule` (one pool, closed on shutdown) — never its own `databaseProvider`.
- `tx.execute` cannot bind a `Date` (postgres.js `unsafe()` sends parameters as text): bind `date.toISOString()` with `::timestamptz`.
