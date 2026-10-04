# packages/db rules

- The Drizzle schema in `src/schema` mirrors `db/sql` and is checked by `schema-drift.db.spec.ts` (columns, keys, full index definitions, CHECK definitions, the view); a new CHECK is written exactly as `pg_get_constraintdef` prints it; `db/sql` stays the source of truth until the switchover — so the two can never silently diverge.
- Drizzle's `.desc()` means `DESC NULLS LAST`; PostgreSQL's plain `DESC` is `NULLS FIRST` — mirror a plain `DESC` index column as `.desc().nullsFirst()`.
