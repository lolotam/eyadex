import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.architecture.md §1.1: a business area never imports another one; `routes/` composes them
// and `shared/` holds what has no business meaning. These folders are not business areas.
const NOT_AREAS = new Set(["routes", "shared", "components", "hooks", "lib", "test"]);
const SRC = resolve(__dirname, "..");

const areas = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !NOT_AREAS.has(entry.name))
  .map((entry) => entry.name);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every `@/<other-area>/` specifier in one area, tests included (a `vi.mock` path counts too). */
function crossAreaImports(area: string): string[] {
  const other = areas.filter((name) => name !== area).join("|");
  const pattern = new RegExp(`["'\`]@/(${other})/`, "g");
  return sourceFiles(join(SRC, area)).flatMap((file) => {
    const found = readFileSync(file, "utf8").match(pattern) ?? [];
    const where = relative(SRC, file).replaceAll("\\", "/");
    return found.map((specifier) => `${where} -> ${specifier.slice(1)}`);
  });
}

describe("business area boundaries", () => {
  it("finds the business areas", () => {
    expect(areas).toEqual(expect.arrayContaining(["patients", "visits", "appointments"]));
  });

  it("no business area imports another one", () => {
    expect(areas.flatMap(crossAreaImports)).toEqual([]);
  });
});
