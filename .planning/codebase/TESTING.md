# Testing Patterns

**Analysis Date:** 2025-04-14

## Test Framework

**Runner:**
- **Playwright** 1.58.2 (`@playwright/test`)
- Config: `playwright.config.ts`
- Tests run against full application (integration/E2E style, not unit)

**Assertion Library:**
- **Playwright built-in expectations** (e.g., `expect(locator).toBeVisible()`, `expect(res.ok()).toBeTruthy()`)

**Run Commands:**
```bash
npx playwright test                    # Run all tests in tests/ directory
npx playwright test --headed           # Run with visible browser
npx playwright test --debug            # Debug mode (Playwright Inspector)
npx playwright test --workers=1        # Run sequentially (single worker)
```

**Type Checking:**
```bash
npm run check                          # TypeScript noEmit check after every change
```

## Test File Organization

**Location:**
- Tests live in `tests/` directory at project root
- One `.spec.ts` file per feature/page

**Current Test Files:**
- `tests/assortment.spec.ts` — Assortment Planning page (8 tests)
- `tests/prompt-validation.spec.ts` — Prompt generation validation (4 tests)

**Naming:**
- Files: `{feature}.spec.ts` (e.g., `assortment.spec.ts`)
- Tests: Descriptive human-readable names (e.g., "page loads with hero and empty state")

**Structure:**
```
tests/
├── assortment.spec.ts              # Feature-specific tests
└── prompt-validation.spec.ts       # Validation/regression tests
```

## Test Structure

**Suite Organization:**
```typescript
import { test, expect } from "@playwright/test";

test.describe("Feature Name", () => {
  test("test case 1: description of behavior", async ({ page }) => {
    await page.goto("http://localhost:5000/route");
    await expect(page.locator("selector")).toBeVisible();
  });

  test("test case 2: description of behavior", async ({ request }) => {
    const res = await request.get("http://localhost:5000/api/endpoint");
    expect(res.ok()).toBeTruthy();
  });
});
```

**Patterns:**

**Page Navigation & Visibility:**
```typescript
test("page loads with hero and empty state", async ({ page }) => {
  await page.goto("http://localhost:5000/assortment");
  await expect(page.locator("h1")).toContainText("Assortment Planning");
  await expect(page.getByText("Select a BDM to get started")).toBeVisible();
});
```

**User Interaction (typing, clicking):**
```typescript
test("BDM dropdown shows names after typing", async ({ page }) => {
  await page.goto("http://localhost:5000/assortment");
  const input = page.getByPlaceholder("Search BDM name...");
  await input.fill("GANESH");
  await expect(page.getByRole("button", { name: /GANESH SHARMA/i })).toBeVisible();
});
```

**Test ID Selectors:**
```typescript
test("nav link exists", async ({ page }) => {
  await page.goto("http://localhost:5000/assortment");
  await expect(page.getByTestId("nav-assortment")).toBeVisible();
  await expect(page.getByTestId("nav-assortment")).toHaveText("Assortment");
});
```

**API Testing (Request Context):**
```typescript
test("API: import-status returns correct counts", async ({ request }) => {
  const res = await request.get("http://localhost:5000/api/assortment/import-status");
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.salesCount).toBeGreaterThan(5000);
  expect(data.stockCount).toBeGreaterThan(15000);
});
```

**API Testing with POST:**
```typescript
test("API: bdm-profile returns sales data", async ({ request }) => {
  const res = await request.post("http://localhost:5000/api/assortment/generate-recommendations", {
    data: { bdmName: "GANESH SHARMA" },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.profile.avgStockAge).toBeDefined();
  expect(Array.isArray(data.profile.stockTypeBreakdown)).toBeTruthy();
});
```

## Mocking

**Framework:** None — tests run against full integration

**Approach:**
- No mocking of external APIs (tests hit real Gemini, OpenAI, Grok)
- No mocking of database (tests hit real PostgreSQL)
- No mocking of file system (tests use real disk uploads)
- Tests validate **end-to-end behavior** only

**What NOT to Mock:**
- HTTP requests (use real API endpoints)
- Database queries (use real DB connection)
- File uploads (use real file system)
- External services (Gemini, OpenAI, Grok all called live)

**Why No Mocking:**
- Project is full-stack with tight integration between client/server
- Testing real behavior more valuable than isolated unit tests
- Mocking adds complexity without catching integration bugs
- Run time acceptable for feature validation

## Fixtures and Factories

**Test Data:**
- Hardcoded in test cases (e.g., `bdmName: "GANESH SHARMA"`)
- No separate fixtures or factory files
- API response validation done inline with `expect()` chains

**Example:**
```typescript
test("Recommendations include age and score fields", async ({ request }) => {
  const res = await request.post("http://localhost:5000/api/assortment/generate-recommendations", {
    data: { bdmName: "GANESH SHARMA" },  // Hardcoded test data
  });
  const data = await res.json();
  expect(data.profile.avgStockAge).toBeDefined();
  if (data.recommendations.length > 0 && data.recommendations[0].suggested) {
    const suggested = data.recommendations[0].suggested;
    expect(suggested.score).toBeDefined();
    expect(typeof suggested.score).toBe("number");
  }
});
```

**Location:**
- Test data inline in test files (no separate data directory)

## Coverage

**Requirements:** No coverage threshold enforced

**View Coverage:**
```bash
# Playwright does not generate coverage reports by default
# Coverage would require additional instrumentation setup
# Currently not configured in project
```

**Current Approach:**
- Tests focus on critical user flows (page loads, API responses, data validation)
- Not all code paths covered — tests are integration-level only
- No separate unit tests

## Test Types

**Page/Component Tests:**
- Load page at URL
- Verify DOM elements visible
- Test user interactions (typing, clicking)
- Check navigation links present
- Example: `tests/assortment.spec.ts` tests UI loading and navigation

**API/Integration Tests:**
- Call endpoint with request fixture
- Verify response status (`.ok()`)
- Parse JSON response
- Validate response schema (check fields exist and have correct types)
- Example: `tests/assortment.spec.ts` API tests

**Regression/Validation Tests:**
- Validate prompt generation correctness
- Check constraints applied correctly (e.g., Far size, no stones)
- Ensure stone names appear/disappear as expected
- Example: `tests/prompt-validation.spec.ts` validates design prompts

**E2E Tests:**
Not used — all tests are integration-level without full user flows.

## Common Patterns

**Navigation & Setup:**
```typescript
test("name of test", async ({ page }) => {
  // Navigate to page
  await page.goto("http://localhost:5000/route");

  // Wait for content to load
  await expect(page.locator("selector")).toBeVisible();
});
```

**Async Testing:**
```typescript
test("async operation completes", async ({ page }) => {
  // await all async operations
  await input.fill("value");
  await expect(result).toBeVisible();
});
```

**Multiple Assertions in Single Test:**
```typescript
test("multiple validations", async ({ request }) => {
  const res = await request.get("http://localhost:5000/api/endpoint");

  // First assertion
  expect(res.ok()).toBeTruthy();

  // Parse and validate data
  const data = await res.json();
  expect(data.field1).toBeDefined();
  expect(Array.isArray(data.field2)).toBeTruthy();
  expect(data.field2.length).toBeGreaterThan(0);
});
```

**Conditional Assertions (optional fields):**
```typescript
// Only check nested field if parent exists
if (data.recommendations.length > 0 && data.recommendations[0].suggested) {
  const suggested = data.recommendations[0].suggested;
  expect(suggested.score).toBeDefined();
  expect(typeof suggested.score).toBe("number");
}
```

**Form Interaction Pattern:**
```typescript
test("form interaction", async ({ page }) => {
  await page.goto("http://localhost:5000/form-page");

  // Find input by placeholder
  const input = page.getByPlaceholder("Placeholder text");

  // Type value
  await input.fill("search term");

  // Wait for results
  await expect(page.getByRole("button", { name: /expected text/i })).toBeVisible();
});
```

**Regex Matching:**
```typescript
// Case-insensitive substring match
await expect(page.getByText(/Sales: [\d,]+ records/)).toBeVisible();

// Role-based with partial name match
await expect(page.getByRole("button", { name: /GANESH SHARMA/i })).toBeVisible();
```

## Playwright Configuration

**File:** `playwright.config.ts`

**Settings:**
```typescript
export default defineConfig({
  testDir: "./tests",              // Tests in /tests directory
  timeout: 30_000,                 // 30s timeout per test
  use: {
    baseURL: "http://localhost:5000",  // Default test server URL
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } }
  ],  // Only Chromium browser tested
});
```

**Key Configuration Points:**
- **Test directory:** `./tests` (fixed, not customizable per spec)
- **Base URL:** `http://localhost:5000` (dev server running locally)
- **Timeout:** 30 seconds per test
- **Browser:** Chromium only (Firefox/WebKit not configured)
- **Parallelization:** Default workers (usually CPU count) — can override with `--workers=1`

## Before Running Tests

**Prerequisites:**
1. **Dev server running:** `npm run dev` on port 5000
2. **Database up:** PostgreSQL + pgvector accessible via `DATABASE_URL`
3. **Environment variables:** All `.env` vars loaded (GEMINI_API_KEY, OPENAI_API_KEY, GROK_API_KEY, etc.)
4. **Node dependencies:** `npm install` already run

**Typical Test Session:**
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests in watch mode
npx playwright test --headed      # or specific file
npx playwright test tests/assortment.spec.ts --headed
```

## Test Debugging

**Debug Mode:**
```bash
npx playwright test --debug
# Opens Playwright Inspector with step-through debugging
```

**Headed Mode:**
```bash
npx playwright test --headed
# Shows visible browser window as tests run
```

**View Logs:**
```bash
# Playwright logs printed to console
# Watch for API responses, navigation logs, errors
```

**Common Issues:**

**Test fails with "Timeout":**
- Dev server not running (`npm run dev`)
- Database not accessible
- Network latency for AI API calls (Gemini/OpenAI timeout after ~120s)

**Test fails with "Not found":**
- Wrong URL (check `baseURL` in config)
- Page route not registered in `client/src/App.tsx`
- Component not rendering (check errors in dev console)

**Test fails with "Element not found":**
- Selector string wrong (use browser DevTools to inspect)
- Element not visible (check `toBeVisible()` expectation)
- Page still loading (add `await page.waitForLoadState()` before selector check)

## Test Isolation

**State Between Tests:**
- Each test gets a fresh browser context (new page)
- Database state persists across tests (if needed, add setup/teardown)
- File system uploads persist (tests should clean up if needed)
- No automatic test isolation or rollback

**If Tests Interfere:**
1. Add `test.beforeEach()` for setup
2. Add `test.afterEach()` for cleanup
3. Use different test data (e.g., unique BDM names per test)

---

*Testing analysis: 2025-04-14*
