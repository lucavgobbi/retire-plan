import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import globals from "globals";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

export default defineConfig([
  includeIgnoreFile(fileURLToPath(new URL(".gitignore", import.meta.url)), { gitignoreResolution: true }),
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    extends: [js.configs.recommended],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [tseslint.configs.recommended],
  },
  {
    // These files use rest destructuring to omit fields from copies.
    files: ["**/*.test.{ts,tsx}", "apps/web/src/store/reducer.ts"],
    rules: { "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    files: ["*.config.{js,mjs,ts,mts}", "**/*.config.{js,mjs,ts,mts}", "scripts/**/*.{js,mjs,ts,mts}"],
    languageOptions: { globals: globals.nodeBuiltin },
  },
  {
    files: ["**/*.{cjs,cts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{js,jsx,ts,tsx}"],
    ignores: ["**/*.worker.{js,ts}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["apps/web/src/**/*.worker.{js,ts}"],
    languageOptions: { globals: globals.worker },
  },
]);
