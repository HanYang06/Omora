import { readFileSync } from "node:fs";

import js from "@eslint/js";
import tseslint from "typescript-eslint";

const budget = JSON.parse(readFileSync(new URL("../budget.json", import.meta.url), "utf8"));
const tsLimits = { ...budget.defaults, ...(budget.suffixes?.[".ts"] ?? {}) };
const tsxLimits = { ...budget.defaults, ...(budget.suffixes?.[".tsx"] ?? {}) };

const sizeRules = (limits) => ({
  "max-lines-per-function": [
    "error",
    { max: limits.functionLines, skipBlankLines: true, skipComments: true },
  ],
  "max-params": ["error", limits.params],
  complexity: ["error", limits.complexity],
  "max-depth": ["error", 4],
  "max-statements": ["error", 40],
  "max-nested-callbacks": ["error", 3],
  "max-classes-per-file": ["error", 1],
});

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "eslint.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/omora_kernel/**", "**/omora_sdk/**"],
              message: "前端只能通过 rpc 层访问内核",
            },
          ],
        },
      ],
      ...sizeRules(tsLimits),
    },
  },
  {
    files: ["**/*.tsx"],
    rules: sizeRules(tsxLimits),
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
