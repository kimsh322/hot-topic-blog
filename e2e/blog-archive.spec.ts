import { test, expect } from "@playwright/test";

test.describe("아카이브", () => {
  test("날짜 목록 렌더링", async ({ page }) => {
    await page.goto("/archive");
    const items = page.locator("[data-testid='archive-date-item']");
    await expect(items.first()).toBeVisible();
  });

  test("날짜 클릭 → 해당 날짜 페이지로 이동", async ({ page }) => {
    await page.goto("/archive");
    await page.locator("[data-testid='archive-date-item']").first().click();
    await expect(page).toHaveURL(/\/archive\/\d{4}-\d{2}-\d{2}/);
    await expect(
      page.locator("[data-testid='topic-card']").first(),
    ).toBeVisible();
  });
});
