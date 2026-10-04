# apps/api rules

- Modules live in `src/modules/<module>/` (domain, ports, persistence, queries, `<module>.module.ts`, `index.ts`); persistence uses only `@eyadex/db` wrappers with bound `sql` — so tenant isolation and the import arrows stay checkable.
