import { test, expect } from "@playwright/test";

test.describe("Assortment Planning Page", () => {
  test("page loads with hero and empty state", async ({ page }) => {
    await page.goto("http://localhost:5000/assortment");
    await expect(page.locator("h1")).toContainText("Assortment Planning");
    await expect(page.getByText("Select a BDM to get started")).toBeVisible();
  });

  test("BDM dropdown shows names after typing", async ({ page }) => {
    await page.goto("http://localhost:5000/assortment");
    const input = page.getByPlaceholder("Search BDM name...");
    await input.fill("GANESH");
    await expect(page.getByRole("button", { name: /GANESH SHARMA/i })).toBeVisible();
  });

  test("nav link exists", async ({ page }) => {
    await page.goto("http://localhost:5000/assortment");
    await expect(page.getByTestId("nav-assortment")).toBeVisible();
    await expect(page.getByTestId("nav-assortment")).toHaveText("Assortment");
  });

  test("Data Import panel shows counts after expand", async ({ page }) => {
    await page.goto("http://localhost:5000/assortment");
    await page.getByText("Data Import").click();
    await expect(page.getByText(/Sales: [\d,]+ records/)).toBeVisible();
    await expect(page.getByText(/Stock: [\d,]+ items/)).toBeVisible();
  });

  test("API: import-status returns correct counts", async ({ request }) => {
    const res = await request.get("http://localhost:5000/api/assortment/import-status");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.salesCount).toBeGreaterThan(5000);
    expect(data.stockCount).toBeGreaterThan(15000);
  });

  test("API: bdm-list returns names", async ({ request }) => {
    const res = await request.get("http://localhost:5000/api/assortment/bdm-list");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.bdmNames.length).toBeGreaterThan(10);
    expect(data.bdmNames).toContain("GANESH SHARMA");
  });

  test("API: bdm-profile returns sales data", async ({ request }) => {
    const res = await request.get("http://localhost:5000/api/assortment/bdm-profile/GANESH%20SHARMA");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.bdmName).toBe("GANESH SHARMA");
    expect(data.totalSales).toBeGreaterThan(0);
    expect(data.topCategories.length).toBeGreaterThan(0);
  });

  test("API: state-list returns states", async ({ request }) => {
    const res = await request.get("http://localhost:5000/api/assortment/state-list");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data.states)).toBeTruthy();
    expect(data.states.length).toBeGreaterThan(0);
  });

  test("State dropdown shows states", async ({ page }) => {
    await page.goto("http://localhost:5000/assortment");
    const select = page.locator("select");
    await expect(select).toBeVisible();
    // Should have more than just the placeholder option
    const options = select.locator("option");
    expect(await options.count()).toBeGreaterThan(1);
  });

  test("Recommendations include age and score fields", async ({ request }) => {
    const res = await request.post("http://localhost:5000/api/assortment/generate-recommendations", {
      data: { bdmName: "GANESH SHARMA" },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.profile.avgStockAge).toBeDefined();
    expect(Array.isArray(data.profile.stockTypeBreakdown)).toBeTruthy();
    if (data.recommendations.length > 0 && data.recommendations[0].suggested) {
      const suggested = data.recommendations[0].suggested;
      expect(suggested.score).toBeDefined();
      expect(typeof suggested.score).toBe("number");
    }
  });
});
