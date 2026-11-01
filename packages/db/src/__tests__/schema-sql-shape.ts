/** Match pg_indexes.indexdef, including PostgreSQL's bare boolean partial predicates. */
export function schemaIndexSql(
  table: string,
  name: string,
  unique: boolean,
  method: string,
  cols: string[],
  where?: string,
  nullsNotDistinct = false,
): string {
  const predicate =
    where === undefined
      ? ""
      : /^[a-z_][a-z0-9_]*$/.test(where)
        ? ` WHERE ${where}`
        : ` WHERE (${where})`;
  return (
    `CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON public.${table} USING ${method} (${cols.join(", ")})` +
    (nullsNotDistinct ? " NULLS NOT DISTINCT" : "") +
    predicate
  );
}

// information_schema spells `time` in full (0042, ADR-0026) and calls char(n) `character` (0060); Drizzle
// prints the short forms.
// information_schema names every array type ARRAY (finance_report_exports.patient_ids, 0068).
export const sqlTypeOf = (type: string): string =>
  type === "time"
    ? "time without time zone"
    : /^char\(\d+\)$/.test(type)
      ? "character"
      : type.endsWith("[]")
        ? "ARRAY"
        : type;
