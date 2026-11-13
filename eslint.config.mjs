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
    name: "omora/ui-engine/boundaries/no-build",
    files: ["app/ui-engine/src/**/*.{ts,tsx}"],
    // build 是构建期 adapter：除 build 自身与测试外，运行时代码不得 import build/**。
    ignores: ["**/*.test.{ts,tsx}", "app/ui-engine/src/build/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "build 只允许构建期自身引用；运行时不得 import build/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/no-legacy",
    files: ["app/ui-engine/src/**/*.{ts,tsx}"],
    // legacy 的合法引用方：app（组合根）、build（构建期 adapter：启动骨架预渲染）
    // 与 generated（生成物 static-tree 就是旧快照数据，随 legacy 删除一起消失）；测试不卡。
    ignores: [
      "**/*.test.{ts,tsx}",
      "app/ui-engine/src/app/**",
      "app/ui-engine/src/build/**",
      "app/ui-engine/src/generated/**",
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
                "legacy 只允许 app/ 与 build/（过渡期 adapter）引用；其余层不得 import legacy/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/contract",
    files: ["app/ui-engine/src/contract/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // contract 是最底层：只依赖自己（纯类型 / 纯函数）与同层模块，不 import 任何其他层。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/link/**", "../link/**", "../../link/**", "../../../link/**"],
              message: "contract 层不得 import link/",
            },
            {
              group: ["**/engine/**", "../engine/**", "../../engine/**", "../../../engine/**"],
              message: "contract 层不得 import engine/",
            },
            {
              group: ["**/host/**", "../host/**", "../../host/**", "../../../host/**"],
              message: "contract 层不得 import host/",
            },
            {
              group: [
                "**/renderer/**",
                "../renderer/**",
                "../../renderer/**",
                "../../../renderer/**",
              ],
              message: "contract 层不得 import renderer/",
            },
            {
              group: [
                "**/components/**",
                "../components/**",
                "../../components/**",
                "../../../components/**",
              ],
              message: "contract 层不得 import components/",
            },
            {
              group: ["**/app/**", "../app/**", "../../app/**", "../../../app/**"],
              message: "contract 层不得 import app/",
            },
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**", "../../../legacy/**"],
              message: "contract 层不得 import legacy/",
            },
            {
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "contract 层不得 import build/",
            },
            {
              group: [
                "**/platform/**",
                "../platform/**",
                "../../platform/**",
                "../../../platform/**",
              ],
              message: "contract 层不得 import platform/",
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
      // legacy 只依赖 contract / renderer / components（旧快照三栏壳组合组件做渲染）；
      // 不碰宿主、引擎、链接器、入口与构建期 adapter。
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
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "legacy 层不得 import build/",
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
      // renderer 是最底层：只依赖 contract，不管组件、宿主、引擎、平台与入口。
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
            {
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "renderer 层不得 import build/",
            },
            {
              group: [
                "**/platform/**",
                "../platform/**",
                "../../platform/**",
                "../../../platform/**",
              ],
              message: "renderer 层不得 import platform/",
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
            {
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "components 层不得 import build/",
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
      // engine 只允许 contract / link / engine 自己；host / platform / app 都不行。
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
            {
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "engine 层不得 import build/",
            },
            {
              group: [
                "**/platform/**",
                "../platform/**",
                "../../platform/**",
                "../../../platform/**",
              ],
              message: "engine 层不得 import platform/",
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
            {
              group: ["**/build/**", "../build/**", "../../build/**", "../../../build/**"],
              message: "host 层不得 import build/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/platform",
    files: ["app/ui-engine/src/platform/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // platform 是宿主工具（媒体 / 捕获 / 搜索），只依赖 contract 与 platform 内部；
      // 不碰渲染、组件、引擎、宿主设施、链接器、入口与构建期 adapter。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/renderer/**", "../renderer/**", "../../renderer/**"],
              message: "platform 层不得 import renderer/",
            },
            {
              group: ["**/components/**", "../components/**", "../../components/**"],
              message: "platform 层不得 import components/",
            },
            {
              group: ["**/engine/**", "../engine/**", "../../engine/**"],
              message: "platform 层不得 import engine/",
            },
            {
              group: ["**/host/**", "../host/**", "../../host/**"],
              message: "platform 层不得 import host/",
            },
            {
              group: ["**/link/**", "../link/**", "../../link/**"],
              message: "platform 层不得 import link/",
            },
            {
              group: ["**/legacy/**", "../legacy/**", "../../legacy/**"],
              message: "platform 层不得 import legacy/",
            },
            {
              group: ["**/app/**", "../app/**", "../../app/**"],
              message: "platform 层不得 import app/",
            },
            {
              group: ["**/build/**", "../build/**", "../../build/**"],
              message: "platform 层不得 import build/",
            },
          ],
        },
      ],
    },
  },
  {
    name: "omora/ui-engine/boundaries/build",
    files: ["app/ui-engine/src/build/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      // build 是构建期 adapter：可以依赖 contract / link / renderer / components /
      // host / legacy（启动骨架预渲染仍走 legacy），但不碰 app 与 engine / platform。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/app/**", "../app/**", "../../app/**"],
              message: "build 层不得 import app/（构建期 adapter 不进组合根）",
            },
            {
              group: ["**/engine/**", "../engine/**", "../../engine/**"],
              message: "build 层不得 import engine/",
            },
            {
              group: ["**/platform/**", "../platform/**", "../../platform/**"],
              message: "build 层不得 import platform/",
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
