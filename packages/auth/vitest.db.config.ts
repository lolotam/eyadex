import { defineConfig } from "vitest/config";

// A missing URL fails the run in the test setup; it never quietly skips and reports green.
export default defineConfig({
  test: {
    include: ["src/**/*.db.spec.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
