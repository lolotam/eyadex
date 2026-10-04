# packages/db rules

- The Drizzle schema in `src/schema` mirrors `db/sql` and is checked by `schema-drift.db.spec.ts`; `db/sql` stays the source of truth until the switchover — so the two can never silently diverge.
