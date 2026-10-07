import { defineConfig } from "vitest/config";

// A missing URL must fail this run, never quietly skip it and report green.
for (const name of ["EYADEX_TEST_OWNER_URL", "EYADEX_TEST_APP_URL", "EYADEX_TEST_DISPATCHER_URL"]) {
  if (!process.env[name]) throw new Error(`${name} is not set — @eyadex/worker test:db needs it`);
}

export default defineConfig({
  test: {
    include: ["src/**/*.db.spec.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
