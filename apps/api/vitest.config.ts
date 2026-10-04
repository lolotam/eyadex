import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    // Database tests need PostgreSQL and run through `test:db` (vitest.db.config.ts) only.
    exclude: ["src/**/*.db.spec.ts", "node_modules/**"],
  },
});
