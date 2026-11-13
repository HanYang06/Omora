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
    name: "omora/ui-engine/boundaries/no-legacy",
    files: ["app/ui-engine/src/**/*.{ts,tsx}"],
    // legacy 的合法引用方：app（组合根）与 compiler（过渡期 adapter）；测试不卡。
    ignores: [
      "**/*.test.{ts,tsx}",
      "app/ui-engine/src/app/**",
      "app/ui-engine/src/compiler/**",
      "app/ui-engine/src/legacy/**",
      "app/ui-engine/src/renderer/**",
      "app/ui-engine/src/components/**",
      "app/ui-engine/src/engine/**",
      "app/ui-engine/src/host/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**", "../../../legacy/**"],
              message:
                "legacy 只允许 app/ 与 compiler/（过渡期 adapter）引用；其余层不得 import legacy/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/legacy",
    files: ["app/ui-engine/src/legacy/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // legacy 只依赖 contract / core 类型 / renderer；不碰宿主、引擎、链接器、组件与入口。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/host/**", "../host/**", "../../host/**", "../../../host/**"],
              message: "legacy 层不得 import host/",
            },
            {
              group: ["**/engine/**", "../engine/**", "../../engine/**", "../../../engine/**"],
              message: "legacy 层不得 import engine/",
            },
            {
              group: ["**/link/**", "../link/**", "../../link/**", "../../../link/**"],
              message: "legacy 层不得 import link/",
            },
            {
              group: ["**/app/**", "../app/**", "../../app/**", "../../../app/**"],
              message: "legacy 层不得 import app/",
            },
            {
              group: ["**/components/**", "../components/**", "../../components/**"],
              message: "legacy 层不得 import components/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/renderer",
    files: ["app/ui-engine/src/renderer/**/*.{ts,tsx}"],
    // 测试文件允许跨层（renderer_move.test 会 import app/slot_registry）。
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // renderer 是最底层：只依赖 contract / core 类型，不管组件、宿主、引擎与入口。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/host/**", "../host/**", "../../host/**", "../../../host/**"],
              message:
                "renderer 层不得 import host/（依赖方向 contract → renderer → components → app）",
            },
            {
              group: ["**/engine/**", "../engine/**", "../../engine/**", "../../../engine/**"],
              message: "renderer 层不得 import engine/",
            },
            {
              group: ["**/link/**", "../link/**", "../../link/**", "../../../link/**"],
              message: "renderer 层不得 import link/",
            },
            {
              group: ["**/app/**", "../app/**", "../../app/**", "../../../app/**"],
              message: "renderer 层不得 import app/",
            },
            {
              group: ["**/components/**", "../components/**", "../../components/**"],
              message: "renderer 层不得 import components/",
            },
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**", "../../../legacy/**"],
              message: "renderer 层不得 import legacy/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/components",
    files: ["app/ui-engine/src/components/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // components 只依赖 contract、renderer 类型与 platform 工具；不碰宿主/引擎/链接器/入口。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/host/**", "../host/**", "../../host/**", "../../../host/**"],
              message: "components 层不得 import host/（依赖方向 renderer → components → app）",
            },
            {
              group: ["**/engine/**", "../engine/**", "../../engine/**", "../../../engine/**"],
              message: "components 层不得 import engine/",
            },
            {
              group: ["**/link/**", "../link/**", "../../link/**", "../../../link/**"],
              message: "components 层不得 import link/",
            },
            {
              group: ["**/app/**", "../app/**", "../../app/**", "../../../app/**"],
              message: "components 层不得 import app/",
            },
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**", "../../../legacy/**"],
              message: "components 层不得 import legacy/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/engine",
    files: ["app/ui-engine/src/engine/**/*.{ts,tsx}"],
    rules: {
      // 依赖方向：contract → link → engine → host → renderer/components → app。
      // engine 只允许 contract / link / engine 自己；host / dom / app 都不行。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/host/**", "../host/**", "../../host/**", "../../../host/**"],
              message: "engine 层不得 import host/（依赖方向 contract → link → engine → host）",
            },
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**", "../../../legacy/**"],
              message: "engine 层不得 import legacy/（engine 只依赖 contract / link）",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/host",
    files: ["app/ui-engine/src/host/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**", "../../../legacy/**"],
              message: "host 层不得 import legacy/（依赖方向 host → renderer）",
            },
          ],
        },
      ],
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
