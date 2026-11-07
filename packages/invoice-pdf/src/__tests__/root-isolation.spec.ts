import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("pure model entrypoint", () => {
  it("loads without resolving filesystem, child-process or runtime modules", () => {
    const entry = new URL("../index.ts", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { registerHooks } from "node:module";
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (/^(node:)?(fs|child_process)(\\/|$)/.test(specifier) ||
            specifier.includes("/runtime")) throw new Error("impure root import");
        return nextResolve(specifier, context);
      }});
      const model = await import(${JSON.stringify(entry)});
      if (typeof model.invoicePdfModel !== "function") process.exit(1);
    `,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
