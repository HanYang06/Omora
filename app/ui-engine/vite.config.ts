import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
