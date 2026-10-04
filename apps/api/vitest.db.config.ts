import { defineConfig } from "vitest/config";

// A missing variable fails this run in the test setup; it never quietly skips and reports green.
export default defineConfig({
  test: {
    include: ["src/**/*.db.spec.ts"],
    // The database is shared and not empty, so the files must never race each other on it.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
