import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    // The dispatcher's database specs run under test:db, against real PostgreSQL.
    exclude: ["src/**/*.db.spec.ts"],
  },
});
