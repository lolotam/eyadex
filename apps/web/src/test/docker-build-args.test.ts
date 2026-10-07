import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vite compiles VITE_API_MODE into the bundle, so the production image can only switch to the real
// API if the Dockerfile accepts it as a build argument before the web build runs.
const dockerfile = readFileSync(path.resolve(__dirname, "../../../../Dockerfile"), "utf8");

describe("web Dockerfile", () => {
  it("takes VITE_API_MODE as a build argument, defaulting to the mock, before the web build", () => {
    const arg = dockerfile.indexOf("ARG VITE_API_MODE=mock");
    const env = dockerfile.indexOf("ENV VITE_API_MODE=$VITE_API_MODE");
    const build = dockerfile.indexOf("RUN pnpm --filter @eyadex/web build");
    expect(arg).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(arg);
    expect(build).toBeGreaterThan(env);
  });
});
