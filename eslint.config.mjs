/**
 * ESLint flat config（仓库根）：覆盖 TS 渲染引擎与桌面壳主进程。
 *
 * 为什么根依赖里还有一个 typescript@5.9：type-aware 规则要读完整类型信息，走的是
 * TypeScript 的经典 JS 编译 API（createProgram / createSourceFile）。仓库自身用
 * typescript@7（原生编译器），它只导出 `./unstable/*` 下的新 API，typescript-eslint
 * 8.x 还读不了。所以根的 typescript 只当 lint 的类型信息提供者，app 仍用自己的 TS 7。
 *
 * 这里是唯一一处关闭规则的地方，每条都写了理由；源码里不放 disable 注释，
 * 因为 reportUnusedDisableDirectives 会把没用上的 disable 当错误。
 */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    name: "omora/ignores",
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/*.d.ts"],
  },
  {
    name: "omora/ui-engine",
    files: ["app/ui-engine/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 下划线开头 = 故意不用的参数 / 变量（测试替身的签名要对齐真实接口）
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    name: "omora/ui-engine/tests",
    files: ["app/ui-engine/src/**/*.test.{ts,tsx}"],
    rules: {
      // 测试替身要对齐被测接口的 async 形状（调用方 await 它），但替身里没有可 await 的东西。
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    name: "omora/shell",
    files: ["app/ui-engine/shell/**/*.cjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // .cjs 按定义只有 require；这条规则是给 ESM 项目用的。
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    name: "omora/linter",
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
);
