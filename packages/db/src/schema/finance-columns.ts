import { sql } from "drizzle-orm";
import { bigint, check, customType } from "drizzle-orm/pg-core";

// Column helpers shared by the finance tables (finance.ts, finance-invoices.ts).
export const tz = { withTimezone: true, mode: "date" } as const;
export const minor = (name: string) => bigint(name, { mode: "bigint" });
// drizzle-orm 0.45 has no bytea column type.
export const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const lineCap = (table: string, column: string) =>
  check(
    `${table}_${column}_check`,
    sql.raw(`((${column} >= 0) AND (${column} <= '1000000000000'::bigint))`),
  );
export const atLeastZero = (table: string, column: string) =>
  check(`${table}_${column}_check`, sql.raw(`(${column} >= 0)`));
export const CURRENCIES =
  "(currency = ANY (ARRAY['KWD'::bpchar, 'BHD'::bpchar, 'OMR'::bpchar, 'SAR'::bpchar, 'AED'::bpchar, 'QAR'::bpchar]))";
