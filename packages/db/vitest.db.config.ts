import { defineConfig } from "vitest/config";

import { requireTestUrls } from "./src/__tests__/test-urls.ts";

// A missing variable must fail this run, never quietly skip the suite and report green.
requireTestUrls();

export default defineConfig({
  test: {
    include: ["src/**/*.db.spec.ts"],
    // The database is shared and not empty (fixtures accumulate), so the files must never race
    // each other on it.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
