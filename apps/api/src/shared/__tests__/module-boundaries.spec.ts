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

describe("module boundaries", () => {
  it("no controller imports or builds a Pg adapter; the module binds it and injects the port", () => {
    const modules = readdirSync(modulesDir).filter((name) =>
      existsSync(join(modulesDir, name, "http")),
    );
    expect(modules).toEqual(expect.arrayContaining(["identity", "platform"]));
    expect(modules.flatMap(adapterUses)).toEqual([]);
  });
});
