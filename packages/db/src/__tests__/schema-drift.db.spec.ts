import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
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
};

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter(isTable);

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
  const indexes = [
    ...config.indexes.map((i) => i.config.name ?? ""),
    ...config.uniqueConstraints.map((u) => u.getName() ?? ""),
    ...config.columns.filter((c) => c.isUnique).map((c) => c.uniqueName ?? ""),
  ].sort();
  return [config.name, { columns, primaryKey: [...primaryKey].sort(), foreignKeys, indexes }];
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
  const indexes = await owner<{ tablename: string; indexname: string }[]>`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname NOT LIKE '%\\_pkey'`;

  const shapes = new Map<string, Shape>();
  const get = (name: string): Shape => {
    let shape = shapes.get(name);
    if (!shape) {
      shape = { columns: [], primaryKey: [], foreignKeys: [], indexes: [] };
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
    if (i.tablename !== "schema_migrations") get(i.tablename).indexes.push(i.indexname);
  for (const shape of shapes.values()) {
    shape.columns.sort();
    shape.primaryKey.sort();
    shape.foreignKeys.sort();
    shape.indexes.sort();
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

  it.each([...mirror.keys()])("%s matches columns, keys and indexes", (name) => {
    expect(mirror.get(name)).toEqual(actual.get(name));
  });
});
