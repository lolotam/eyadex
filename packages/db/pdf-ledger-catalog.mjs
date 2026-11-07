// Read-only comparison using the existing schema-drift comparator over docker exec.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/__tests__/schema-drift.db.spec.ts", "utf8");
const prefix = source
  .slice(0, source.indexOf("describe("))
  .replace(/import \{ afterAll, beforeAll, describe, expect, it \} from "vitest";/, "")
  .replace(/import \{ createOwner \} from "\.\/test-database.ts";/, "")
  .replace('"../schema/index.ts"', '"./src/schema/index.ts"')
  .replace('"./schema-sql-shape.ts"', '"./src/__tests__/schema-sql-shape.ts"');
const compiled = ts.transpileModule(
  prefix.replaceAll('"./src/', '"' + new URL("./src/", import.meta.url).href) +
    "\nexport { databaseShapes, mirrorShape, tables };",
  {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
mkdirSync(new URL("./node_modules/.cache/", import.meta.url), { recursive: true });
const path = new URL("./node_modules/.cache/eyadex-pdf-ledger-catalog.mjs", import.meta.url);
writeFileSync(path, compiled);
try {
  const { databaseShapes, mirrorShape, tables } = await import(path.href);
  const adapter = async (strings) => {
    const sql = "SELECT coalesce(json_agg(q),'[]'::json) FROM (" + strings.join("") + ") q";
    return JSON.parse(
      execFileSync(
        "docker",
        [
          "exec",
          "eyadex-pdf-ledger-5e3991ef",
          "psql",
          "-XAt",
          "-U",
          "eyadex_owner",
          "-d",
          process.env.PDF_PROOF_DATABASE ?? "eyadex_verified",
          "-c",
          sql,
        ],
        { encoding: "utf8" },
      ),
    );
  };
  const actual = await databaseShapes(adapter);
  const mirror = new Map(tables.map(mirrorShape));
  assert.deepEqual([...mirror.keys()].sort(), [...actual.keys()].sort());
  for (const [name, shape] of mirror) assert.deepEqual(shape, actual.get(name), name);
  console.log(`PASS: ${mirror.size} table mirrors match live local PostgreSQL catalog`);
} finally {
  unlinkSync(path);
}
