import { rmSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit is an inspection tool here (ADR-0024): db/sql + db/migrate.sh stay the only way to change
// a database. `push` with this schema would drop every RLS policy, so anything but `pull` is refused
// before drizzle-kit opens a connection or writes a file. A guard rail, not a boundary: `drizzle-kit <cmd>`
// run directly with CLI flags never loads this file, so packages/db/AGENTS.md forbids that; the real
// boundary is that writable production/staging URLs never leave Dokploy.
const ALLOWED_COMMANDS = new Set(["pull", "introspect"]);
const command = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
if (command === undefined || !ALLOWED_COMMANDS.has(command)) {
  throw new Error(
    `drizzle-kit ${command ?? "(no command)"} is disabled in @eyadex/db: only \`pnpm --filter @eyadex/db db:pull\` is allowed (ADR-0024). Change a database through db/sql and db/migrate.sh.`,
  );
}

const url = process.env["DRIZZLE_DATABASE_URL"];
if (!url) {
  throw new Error(
    "DRIZZLE_DATABASE_URL is not set: point it at a database migrated with db/migrate.sh.",
  );
}

// A second pull into a non-empty folder keeps the first snapshot and SQL, which would then describe an
// older database than schema.ts does — so every pull starts from an empty folder.
const OUT = "./.drizzle-pull";
rmSync(OUT, { recursive: true, force: true });

// Second line of defence: every transaction of the session starts read-only. postgres.js (the only
// driver @eyadex/db installs) sends unknown URL parameters as startup parameters.
const readOnlyUrl = new URL(url);
readOnlyUrl.searchParams.set("default_transaction_read_only", "on");
readOnlyUrl.searchParams.set("application_name", "eyadex-drizzle-kit-pull");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  // Gitignored: a scratch Drizzle rendering of the live database, never committed or applied.
  out: OUT,
  schemaFilter: ["public"],
  dbCredentials: { url: readOnlyUrl.toString() },
});
