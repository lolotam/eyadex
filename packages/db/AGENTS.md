# packages/db rules

- The Drizzle schema in `src/schema` mirrors `db/sql` and is checked by `schema-drift.db.spec.ts` (columns, keys, indexes, CHECK definitions, the view); a new CHECK is written exactly as `pg_get_constraintdef` prints it; `db/sql` stays the source of truth until the switchover — so the two can never silently diverge.
