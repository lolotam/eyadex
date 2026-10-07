import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// apps/api/AGENTS.md: a Pg adapter is bound in `<module>.module.ts` and injected through its port, so
// the HTTP layer depends on ports only and every cross-module read is wired in one place.
const modulesDir = fileURLToPath(new URL("../../modules/", import.meta.url));

const adapterUses = (module: string): string[] => {
  const httpDir = join(modulesDir, module, "http");
  return readdirSync(httpDir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(join(httpDir, file), "utf8");
      const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap(
        ([, names = ""]) => [...names.matchAll(/\bPg[A-Z]\w*/g)].map(([name]) => name),
      );
      const built = [...source.matchAll(/\bnew (Pg[A-Z]\w*)/g)].map(([, name = ""]) => name);
      return [...new Set([...imports, ...built])].map((name) => `${module}/http/${file}: ${name}`);
    });
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // Test fixtures may share identity's HTTP harness; the rule is about the code that ships.
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });

// CLAUDE.architecture.md §2.2 (ADR-0014, owner decision 2026-10-07): outside identity, the only import of
// identity is its index.ts (guards and request types).
const identityDeepImports = (module: string): string[] =>
  sourceFiles(join(modulesDir, module)).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*\/identity\/[^"']*)["']/g)]
      .map(([, target = ""]) => target)
      .filter((target) => !/\/identity\/index\.ts$/.test(target))
      .map((target) => `${file.slice(modulesDir.length)}: ${target}`),
  );

describe("module boundaries", () => {
  it("no module other than identity imports identity except through identity/index.ts", () => {
    const others = readdirSync(modulesDir).filter((name) => name !== "identity");
    expect(others).toEqual(expect.arrayContaining(["platform", "settings", "tenancy"]));
    expect(others.flatMap(identityDeepImports)).toEqual([]);
  });


  it("no controller imports or builds a Pg adapter; the module binds it and injects the port", () => {
    const modules = readdirSync(modulesDir).filter((name) =>
      existsSync(join(modulesDir, name, "http")),
    );
    expect(modules).toEqual(expect.arrayContaining(["identity", "platform", "settings"]));
    expect(modules.flatMap(adapterUses)).toEqual([]);
  });
});
