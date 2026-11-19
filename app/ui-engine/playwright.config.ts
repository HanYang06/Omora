import { defineConfig } from "@playwright/test";

/**
 * 视觉与无障碍回归：跑在 Vite dev server 上，不连 Python。
 *
 * 两个入口都是内置 fixture / 构建产物：
 * - `?engine=slot`：Slot 预览（preview_document）；
 * - `?engine=tree`：V1 树产物（dev 由 vite-tree-dev 现算）。
 *
 * 默认入口（live）要连 Python，不在这里跑。
 * 本地默认用系统 Edge，省掉 207MB 的 Chromium 下载；CI 用 `playwright install chromium`，
 * 并设 `PLAYWRIGHT_CHANNEL=chromium` 或留空。
 */
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : "msedge");

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: "http://127.0.0.1:5199",
    viewport: { width: 1360, height: 880 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev --port 5199 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", ...(channel ? { channel } : {}) } },
  ],
});
