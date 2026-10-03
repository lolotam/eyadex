import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

/**
 * The shared flat config: every non-React lint rule, applied by each app and package through its
 * own eslint.config.js (`export default [...config, …]`). An app adds only what belongs to it —
 * apps/web adds browser globals and the React rules.
 */
const config = tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".agents", ".wrangler", ".tanstack"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);

export default config;
