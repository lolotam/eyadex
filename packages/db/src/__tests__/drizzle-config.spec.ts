import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// drizzle.config.ts must refuse every drizzle-kit command but `pull` before it connects or writes:
// `push` with the mirror would drop every RLS policy, and `generate` / `migrate` would start a second
// migration history beside db/sql (ADR-0024).
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = join(packageDir, "node_modules", "drizzle-kit", "bin.cjs");
// Nothing listens on port 1: if a command ever got past the config, it still could not reach a database.
const UNREACHABLE_URL = "postgres://nobody@127.0.0.1:1/none";

function drizzleKit(args: string[], env: Record<string, string | undefined>) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { cwd: packageDir, env: { ...process.env, ...env }, timeout: 60_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, output: `${stdout}${stderr}` });
      },
    );
  });
}

describe("drizzle.config.ts (inspection only)", () => {
  it.concurrent.each(["push", "generate", "migrate", "check", "studio", "drop", "up", "export"])(
    "refuses `drizzle-kit %s`",
    async (command) => {
      const before = existsSync(join(packageDir, ".drizzle-pull"));
      const { code, output } = await drizzleKit([command], {
        DRIZZLE_DATABASE_URL: UNREACHABLE_URL,
      });
      expect(code).not.toBe(0);
      expect(output).toContain(`drizzle-kit ${command} is disabled in @eyadex/db`);
      // Refused before the scratch folder is cleared or written.
      expect(existsSync(join(packageDir, ".drizzle-pull"))).toBe(before);
    },
    60_000,
  );

  it("refuses `pull` without DRIZZLE_DATABASE_URL instead of guessing a database", async () => {
    const { code, output } = await drizzleKit(["pull"], { DRIZZLE_DATABASE_URL: "" });
    expect(code).not.toBe(0);
    expect(output).toContain("DRIZZLE_DATABASE_URL is not set");
  }, 60_000);
});
