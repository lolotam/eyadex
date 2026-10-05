import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db/sql/0026 seeds the catalogue that packages/contracts declares. New clinics' system roles link to
// these rows by key, so a permission added on one side only would silently create incomplete roles.
const url = process.env["EYADEX_TEST_OWNER_URL"];
let owner: Sql;

beforeAll(() => {
  if (url === undefined || url === "") throw new Error("EYADEX_TEST_OWNER_URL is not set");
  owner = postgres(url, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner?.end();
});

describe("permission catalogue", () => {
  it("the database rows match PERMISSION_CATALOG exactly", async () => {
    const rows = await owner<
      { key: string; action: string; resource: string; scope: string; module: string | null }[]
    >`SELECT key, action, resource, scope, module FROM permissions`;
    const expected = [...PERMISSION_CATALOG]
      .map(({ key, action, resource, scope, module }) => ({ key, action, resource, scope, module }))
      .sort((a, b) => a.key.localeCompare(b.key));
    // Both sides sorted the same way in JS: SQL collation and localeCompare need not agree on ':' / '_'.
    const actual = rows.map((row) => ({ ...row })).sort((a, b) => a.key.localeCompare(b.key));
    expect(actual).toEqual(expected);
  });
});
