import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// apps/api/AGENTS.md: another module's adapter is bound in `<module>.module.ts` and injected, so the
// HTTP layer depends on ports only and the import arrows stay checkable in one file per module.
const modulesDir = fileURLToPath(new URL("../../modules/", import.meta.url));

const adapterImports = (module: string): string[] => {
  const httpDir = join(modulesDir, module, "http");
  return readdirSync(httpDir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(join(httpDir, file), "utf8");
      const fromOthers = source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*"\.\.\/\.\.\/(\w+)\/index\.ts"/g,
      );
      return [...fromOthers].flatMap(([, names = ""]) =>
        [...names.matchAll(/\bPg\w+/g)].map(([name]) => `${module}/http/${file}: ${name}`),
      );
    });
};

describe("module boundaries", () => {
  it("no controller builds another module's Pg adapter; the module binds and injects it", () => {
    const modules = readdirSync(modulesDir).filter((name) =>
      existsSync(join(modulesDir, name, "http")),
    );
    expect(modules).toContain("platform");
    expect(modules.flatMap(adapterImports)).toEqual([]);
  });
});
