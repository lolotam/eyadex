import { configDefaults, defineConfig } from "vitest/config";

// The CI verify job runs `pnpm test` with no database at all, so the unit suite must never pick a
// `*.db.spec.ts` up — those need `pnpm test:db` and a real PostgreSQL (vitest.db.config.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.db.spec.ts"],
  },
});
