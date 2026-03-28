import { test, expect } from "@playwright/test";

test.describe("메인 페이지", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("페이지 타이틀에 핫토픽 포함", async ({ page }) => {
    await expect(page).toHaveTitle(/핫토픽/);
  });

  test("토픽 카드 1~5개 렌더링", async ({ page }) => {
    const cards = page.locator("[data-testid='topic-card']");
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(5);
  });

  test("각 카드에 카테고리 배지", async ({ page }) => {
    const badge = page.locator("[data-testid='category-badge']").first();
    await expect(badge).toBeVisible();
  });

  test("요약 텍스트 50자 이상", async ({ page }) => {
    const summary = page.locator("[data-testid='topic-summary']").first();
    const text = await summary.textContent();
    expect(text!.length).toBeGreaterThan(50);
  });

  test("출처 링크 새 탭으로 열림", async ({ page }) => {
    const link = page.locator("[data-testid='source-link']").first();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("날짜 표시 (YYYY년 M월 D일 형식)", async ({ page }) => {
    const dateEl = page.locator("[data-testid='display-date']");
    await expect(dateEl).toContainText(/\d{4}년 \d{1,2}월 \d{1,2}일/);
  });

  test("JSON-LD 구조화 데이터 존재", async ({ page }) => {
    const jsonLd = page.locator('script[type="application/ld+json"]');
    const count = await jsonLd.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
