import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("web API boundary", () => {
  it("never imports API source, including from tests", () => {
    const violations = sourceFiles(SRC).flatMap((file) => {
      const imports = readFileSync(file, "utf8").matchAll(
        /(?:\bfrom\s*|\b(?:import|require)\s*\(?\s*)["'`]([^"'`]+)["'`]/g,
      );
      return [...imports]
        .map((match) => match[1]!.replaceAll("\\", "/"))
        .filter((path) => /api\/src|apps\/api/.test(path))
        .map((path) => `${relative(SRC, file).replaceAll("\\", "/")} -> ${path}`);
    });
    expect(violations).toEqual([]);
  });
});
