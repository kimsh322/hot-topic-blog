import { test, expect } from "@playwright/test";

test("모바일: 카드가 전체 너비 사용", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const card = page.locator("[data-testid='topic-card']").first();
  const box = await card.boundingBox();
  expect(box!.width).toBeGreaterThan(300);
});

test("다크모드: 배경색 변경됨", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const bg = await page.evaluate(() =>
    window.getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).not.toBe("rgb(255, 255, 255)");
});
