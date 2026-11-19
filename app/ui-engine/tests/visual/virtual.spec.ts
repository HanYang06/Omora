import { test, expect } from "@playwright/test";

test("虚拟列表只挂窗口内的行", async ({ page }) => {
  await page.goto("/?engine=virtual");
  const list = page.locator('[data-type="virtual-list"]');
  await expect(list).toBeVisible();

  const rows = list.locator(".omora-virtual-row");
  await expect(rows.first()).toBeVisible();
  const initial = await rows.count();
  expect(initial).toBeGreaterThan(5);
  expect(initial).toBeLessThan(120);

  await expect(list.locator('.omora-virtual-row[data-index="0"]')).toHaveCount(1);
  await list.evaluate((element) => {
    element.scrollTop = 32000;
  });

  await expect(list.locator('.omora-virtual-row[data-index="0"]')).toHaveCount(0);
  await expect(list.locator('.omora-virtual-row[data-index="999"]')).toHaveCount(1);
});
