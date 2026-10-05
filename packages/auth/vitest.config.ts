import { configDefaults, defineConfig } from "vitest/config";

// The CI verify job has no database: `*.db.spec.ts` run only through `test:db`.
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.db.spec.ts"],
  },
});
