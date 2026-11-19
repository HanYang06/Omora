import { test, expect } from "@playwright/test";

test("原生 dialog 以模态打开，Esc 关闭", async ({ page }) => {
  await page.goto("/?engine=dialog");
  const dialog = page.locator("dialog.omora-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-label", "示例对话框");
  expect(await dialog.evaluate((element) => (element as HTMLDialogElement).matches(":modal"))).toBe(
    true,
  );

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await dialog.evaluate((element) => (element as HTMLDialogElement).open)).toBe(false);
});
