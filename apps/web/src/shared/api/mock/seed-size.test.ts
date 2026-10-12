import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("mock seed responsibilities", () => {
  it("keeps each seed file within the mandatory 300-line limit", () => {
    const oversized = readdirSync(__dirname)
      .filter((name) => /^seed(?:-.*)?\.ts$/.test(name) && !name.endsWith(".test.ts"))
      .flatMap((name) => {
        const lines = readFileSync(join(__dirname, name), "utf8").trimEnd().split(/\r?\n/).length;
        return lines > 300 ? [`${name}: ${lines}`] : [];
      });
    expect(oversized).toEqual([]);
  });
});
