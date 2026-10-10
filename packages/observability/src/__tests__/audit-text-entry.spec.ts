import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as auditText from "../audit-text.ts";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT = /^\s*(?:import|export)\b[^"']*?from\s*["']([^"']+)["']/gm;

/** Every specifier imported by the file and, through relative imports, by everything it reaches. */
function importGraph(entry: string): { files: Set<string>; specifiers: Set<string> } {
  const files = new Set<string>();
  const specifiers = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (specifier === undefined) continue;
      specifiers.add(specifier);
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
    }
  };
  visit(resolve(SRC, entry));
  return { files, specifiers };
}

// The web bundles this subpath from source (the mock writes audit rows with the API's own scrub), so it
// must stay browser-safe: no pino, no node built-in, nothing outside this package.
describe("@eyadex/observability/audit-text subpath", () => {
  it("is declared in the package exports, pointing at audit-text", () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, "../package.json"), "utf8")) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(pkg.exports["./audit-text"]).toEqual({
      types: "./src/audit-text.ts",
      "eyadex-runtime": "./dist/audit-text.js",
      default: "./src/audit-text.ts",
    });
  });

  it("offers the audit scrub only", () => {
    expect(Object.keys(auditText).sort()).toEqual(["scrubAuditText", "scrubAuditValue"]);
  });

  it("imports nothing but its own relative modules, never pino or the logger", () => {
    const { files, specifiers } = importGraph("audit-text.ts");
    expect([...specifiers].filter((s) => !s.startsWith("./"))).toEqual([]);
    const reached = [...files].map((f) => f.slice(SRC.length + 1).replaceAll("\\", "/"));
    expect(reached).not.toContain("logger.ts");
    expect(reached).not.toContain("request-context.ts");
  });
});
