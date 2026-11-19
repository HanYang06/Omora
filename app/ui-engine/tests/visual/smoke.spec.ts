import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core");

const APP = '[data-type="app"]';

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
}

test("V1 树预览：四页导航 + 页面可挂载", async ({ page }) => {
  await page.goto("/?engine=tree");
  await expect(page.locator(APP)).toBeVisible();
  await expect(page.locator('[data-type="page-link"]')).toHaveCount(4);
  await expect(page).toHaveScreenshot("tree-preview.png");
});

test("无障碍：V1 树预览首屏没有 critical 违规", async ({ page }) => {
  await page.goto("/?engine=tree");
  await expect(page.locator(APP)).toBeVisible();
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async (): Promise<AxeViolation[]> => {
    const axe = (
      window as unknown as {
        axe: { run: (ctx: Document) => Promise<{ violations: AxeViolation[] }> };
      }
    ).axe;
    const result = await axe.run(document);
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
    }));
  });
  const critical = violations.filter((violation) => violation.impact === "critical");
  console.log(
    "axe violations:",
    violations.map((violation) => violation.id + "=" + String(violation.impact)),
  );
  expect(critical.map((violation) => violation.id)).toEqual([]);
});
