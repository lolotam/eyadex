import { is, SQL } from "drizzle-orm";
import {
  getTableConfig,
  getViewConfig,
  PgDialect,
  type PgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "../schema/index.ts";
import { createOwner } from "./test-database.ts";

// db/sql is the source of truth; this test fails when the Drizzle mirror stops describing it.
type Shape = {
  columns: string[];
  primaryKey: string[];
  foreignKeys: string[];
  indexes: string[];
  checks: string[];
};

const dialect = new PgDialect();

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter(isTable);
const views = (Object.values(schema) as unknown[]).filter(isView);

function isView(value: unknown): value is Parameters<typeof getViewConfig>[0] {
  try {
    getViewConfig(value as Parameters<typeof getViewConfig>[0]);
    return !isTable(value);
  } catch {
    return false;
  }
}

function isTable(value: unknown): value is PgTable {
  try {
    getTableConfig(value as PgTable);
    return true;
  } catch {
    return false;
  }
}

function mirrorShape(table: PgTable): [string, Shape] {
  const config = getTableConfig(table);
  const inlinePk = config.columns.filter((c) => c.primary).map((c) => c.name);
  const primaryKey = inlinePk.length
    ? inlinePk
    : (config.primaryKeys[0]?.columns.map((c) => c.name) ?? []);
  const columns = config.columns
    .map((c) => `${c.name}:${c.getSQLType()}:${c.notNull ? "not null" : "null"}`)
    .sort();
  const foreignKeys = config.foreignKeys
    .map((fk) => {
      const ref = fk.reference();
      const target = getTableConfig(ref.foreignTable).name;
      return `${fk.getName()}(${ref.columns.map((c) => c.name).join(",")})->${target}(${ref.foreignColumns.map((c) => c.name).join(",")})`;
    })
    .sort();
  // Each index is compared by its full definition as pg_indexes.indexdef prints it — uniqueness, method,
  // every column or expression in order with its direction, and the partial predicate — not its name
  // alone (Codex on PR #24). Expressions render as drizzle-kit would put them in an index; PostgreSQL
  // prints these lower-case identifiers unquoted.
  const define = (name: string, unique: boolean, method: string, cols: string[], where?: string) =>
    `CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON public.${config.name} USING ${method} (${cols.join(", ")})` +
    (where === undefined ? "" : ` WHERE (${where})`);
  const expression = (value: SQL): string =>
    dialect.sqlToQuery(value, "indexes").sql.replaceAll('"', "");
  const indexes = [
    ...config.indexes.map((i) => {
      const cols = i.config.columns.map((c) => {
        if (is(c, SQL)) return expression(c);
        const column = c as { name?: string; indexConfig?: { order?: string; nulls?: string } };
        const desc = column.indexConfig?.order === "desc";
        const nulls = column.indexConfig?.nulls;
        const nullsNote =
          nulls === undefined || (nulls === "first") === desc
            ? ""
            : ` NULLS ${nulls.toUpperCase()}`;
        return `${column.name ?? ""}${desc ? " DESC" : ""}${nullsNote}`;
      });
      const where = i.config.where === undefined ? undefined : expression(i.config.where);
      return define(i.config.name ?? "", i.config.unique, i.config.method ?? "btree", cols, where);
    }),
    ...config.uniqueConstraints.map((u) =>
      define(
        u.getName() ?? "",
        true,
        "btree",
        u.columns.map((c) => c.name),
      ),
    ),
    ...config.columns
      .filter((c) => c.isUnique)
      .map((c) => define(c.uniqueName ?? "", true, "btree", [c.name])),
  ].sort();
  // Each check is written in the mirror exactly as PostgreSQL prints it (pg_get_constraintdef), so the
  // comparison is the full definition, not just the name (Codex on PR #24).
  const checks = config.checks
    .map((c) => `${c.name}:CHECK (${dialect.sqlToQuery(c.value).sql})`)
    .sort();
  return [
    config.name,
    { columns, primaryKey: [...primaryKey].sort(), foreignKeys, indexes, checks },
  ];
}

async function databaseShapes(owner: Sql): Promise<Map<string, Shape>> {
  const columns = await owner<
    { table_name: string; column_name: string; data_type: string; is_nullable: string }[]
  >`
    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`;
  const keys = await owner<
    { table_name: string; name: string; kind: string; cols: string; ref: string | null }[]
  >`
    SELECT rel.relname AS table_name, con.conname AS name, con.contype AS kind,
      (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS cols,
      CASE WHEN con.contype = 'f' THEN (SELECT ref.relname FROM pg_class ref WHERE ref.oid = con.confrelid) || '(' ||
        (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(n, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) || ')' END AS ref
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND con.contype IN ('p', 'f')`;
  // contype 'c' only: PostgreSQL 18 also records NOT NULL as constraints (contype 'n').
  const checks = await owner<{ table_name: string; name: string; def: string }[]>`
    SELECT rel.relname AS table_name, con.conname AS name, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND con.contype = 'c'`;
  const indexes = await owner<{ tablename: string; indexname: string; indexdef: string }[]>`
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname NOT LIKE '%\\_pkey'`;

  const shapes = new Map<string, Shape>();
  const get = (name: string): Shape => {
    let shape = shapes.get(name);
    if (!shape) {
      shape = { columns: [], primaryKey: [], foreignKeys: [], indexes: [], checks: [] };
      shapes.set(name, shape);
    }
    return shape;
  };
  for (const c of columns) {
    // The migration runner's ledger (db/migrate-lib.sh) is not application data.
    if (c.table_name === "schema_migrations") continue;
    get(c.table_name).columns.push(
      `${c.column_name}:${c.data_type}:${c.is_nullable === "YES" ? "null" : "not null"}`,
    );
  }
  for (const k of keys) {
    if (k.table_name === "schema_migrations") continue;
    if (k.kind === "p") get(k.table_name).primaryKey.push(...k.cols.split(","));
    else get(k.table_name).foreignKeys.push(`${k.name}(${k.cols})->${k.ref}`);
  }
  for (const i of indexes)
    if (i.tablename !== "schema_migrations") get(i.tablename).indexes.push(i.indexdef);
  for (const c of checks)
    if (c.table_name !== "schema_migrations") get(c.table_name).checks.push(`${c.name}:${c.def}`);
  for (const shape of shapes.values()) {
    shape.columns.sort();
    shape.primaryKey.sort();
    shape.foreignKeys.sort();
    shape.indexes.sort();
    shape.checks.sort();
  }
  return shapes;
}

describe("Drizzle schema mirror vs db/sql", () => {
  let owner: Sql;
  let actual: Map<string, Shape>;
  const mirror = new Map(tables.map(mirrorShape));

  beforeAll(async () => {
    owner = createOwner();
    actual = await databaseShapes(owner);
  });
  afterAll(async () => {
    await owner.end({ timeout: 5 });
  });

  it("mirrors exactly the tables the baseline creates", () => {
    expect([...mirror.keys()].sort()).toEqual([...actual.keys()].sort());
  });

  it.each([...mirror.keys()])("%s matches columns, keys, indexes and checks", (name) => {
    expect(mirror.get(name)).toEqual(actual.get(name));
  });

  // Views carry no NOT NULL in the catalog, so a view is compared by column name, type and order.
  it("mirrors exactly the views the baseline creates, column by column", async () => {
    const rows = await owner<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.views v ON v.table_schema = c.table_schema AND v.table_name = c.table_name
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position`;
    const inDatabase = new Map<string, string[]>();
    for (const r of rows) {
      inDatabase.set(r.table_name, [
        ...(inDatabase.get(r.table_name) ?? []),
        `${r.column_name}:${r.data_type}`,
      ]);
    }
    const inMirror = new Map(
      views.map((view) => {
        const config = getViewConfig(view);
        const fields = Object.values(config.selectedFields as Record<string, PgColumn>);
        return [config.name, fields.map((c) => `${c.name}:${c.getSQLType()}`)] as const;
      }),
    );
    expect(inMirror).toEqual(inDatabase);
  });
});
