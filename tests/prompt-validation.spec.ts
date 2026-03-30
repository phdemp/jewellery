import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5000";

async function debugPrompt(
  request: Parameters<typeof test>[1] extends (args: { request: infer R }) => unknown ? R : never,
  body: Record<string, unknown>
) {
  const res = await request.post(`${BASE}/api/debug-prompt`, {
    data: body,
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{
    fullPrompt: string;
    polkiSizeConstraint: string;
    isPurePolki: boolean;
    stonesList: string[];
    polkiSizes: string[];
  }>;
}

// ── Test 1: Far size + No stones ───────────────────────────────────────────
test("Far + No stones: prompt contains Far constraint, no colored stone names", async ({ request }) => {
  const data = await debugPrompt(request, {
    category: "Choker",
    productSegment: "Bridal",
    priceBand: "25-50 Lakh",
    polkiSize: JSON.stringify(["Far"]),
    stoneName: JSON.stringify([]),
  });

  const p = data.fullPrompt;

  // Must contain Far size constraint
  expect(p).toContain("FAR SIZE");

  // Must say only polki / no colored stones (from buildImagePrompt pure polki path)
  expect(p).toContain("ONLY polki");
  expect(p).toContain("NO colored gemstones");

  // Far size descriptor mentions 12–20 stones
  expect(p).toContain("12");

  // Must NOT contain the specific previously-broken phrases
  expect(p).not.toContain("emerald drops");
  expect(p).not.toContain("50-55% gold");

  // No stone names (capitalized) from the design elements section
  // Note: BRAND_RULES legitimately mentions "emeralds" (lowercase) in prohibition text — that's fine.
  // We check capital-E "Emerald" (as a requested stone name) is absent.
  expect(p).not.toContain("Emerald");
  // "Ruby" capital R is absent (BRAND_RULES only says lowercase "rubies" in prohibition)
  expect(p).not.toContain("Ruby");

  // Sandwich: polki constraint appears both at start and later in prompt
  const firstOccurrence = p.indexOf("MANDATORY POLKI STONE SIZE");
  const lastOccurrence = p.lastIndexOf("MANDATORY POLKI STONE SIZE");
  expect(firstOccurrence).toBeGreaterThanOrEqual(0);
  expect(lastOccurrence).toBeGreaterThan(firstOccurrence);
});

// ── Test 2: Big size + No stones ───────────────────────────────────────────
test("Big + No stones: prompt contains Big constraint, no colored stone names", async ({ request }) => {
  const data = await debugPrompt(request, {
    category: "Necklace",
    polkiSize: JSON.stringify(["Big"]),
    stoneName: JSON.stringify([]),
  });

  const p = data.fullPrompt;

  expect(p).toContain("BIG SIZE");
  expect(p).toContain("ONLY polki");
  expect(p).not.toContain("Ruby");
  expect(p).not.toContain("Emerald");
  expect(p).not.toContain("50-55% gold");
  expect(p).not.toContain("emerald drops");
});

// ── Test 3: Far + Emerald (regression — stones should appear when requested) ─
test("Far + Emerald: Emerald appears in prompt when explicitly requested", async ({ request }) => {
  const data = await debugPrompt(request, {
    category: "Choker",
    polkiSize: JSON.stringify(["Far"]),
    stoneName: JSON.stringify(["Emerald"]),
  });

  const p = data.fullPrompt;

  // Emerald was requested → must appear in design elements
  expect(p).toContain("Emerald");

  // isPurePolki should be false when stones are provided
  expect(data.isPurePolki).toBe(false);
  expect(data.stonesList).toContain("Emerald");
});

// ── Test 4: No polki size selected ────────────────────────────────────────
test("No polki size: constraint block is absent from prompt", async ({ request }) => {
  const data = await debugPrompt(request, {
    category: "Ring",
    stoneName: JSON.stringify([]),
  });

  const p = data.fullPrompt;

  // No size was selected — constraint must not appear
  expect(p).not.toContain("MANDATORY POLKI STONE SIZE");
  expect(data.polkiSizeConstraint).toBe("");
  expect(data.polkiSizes).toHaveLength(0);
});
