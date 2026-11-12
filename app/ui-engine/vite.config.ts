import { defineConfig } from "vitest/config";
import { staticSkeletonPlugin } from "./src/compiler/vite-plugin";
import { linkerGatePlugin } from "./src/link/vite-plugin";

/**
 * 配置里 import 了引擎源码（启动骨架编译在 `src/compiler/`，链接期门禁在 `src/link/`）。
 * bundle loader 会把引擎整张模块图打进配置并对无扩展名 import 报 native-loader 警告；
 * 统一走 runner loader 让 Vite 在加载时现转，pnpm scripts / CI / `omora dev` 都带这个参数。
 */
export default defineConfig({
  plugins: [staticSkeletonPlugin(), linkerGatePlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    /**
     * 覆盖率只用来发现"没人测过的区域"，不是刷分目标；阈值锁在当前基线之下，
     * 保证只会往上走。cobertura 给 CI / 代码扫描读，text 给人看。
     */
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // 测试自己不算被测代码
        "src/**/*.test.{ts,tsx}",
        // 环境声明（vite-env.d.ts）与纯类型文件（types.ts）没有可执行语句
        "src/**/*.d.ts",
        "src/core/types.ts",
        // 样式不进 TS 覆盖率
        "src/styles/**",
      ],
      reporter: ["text", "cobertura"],
      thresholds: { lines: 54, statements: 53, branches: 52, functions: 53 },
    },
  },
});
