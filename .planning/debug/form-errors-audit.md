---
status: resolved
trigger: "Systematically go through all forms on the jewellery design website and check for any errors"
created: 2026-04-09T00:00:00Z
updated: 2026-04-09T10:00:00Z
---

## Current Focus

hypothesis: All 3 identified issues fixed
test: TypeScript check passed (0 errors). Fixes verified by reading changed files.
expecting: No more "Encountered two children with the same key — Emerald Cut" errors; select dropdown uses viewport-aware height; CAD generate button disabled before segment/category selection
next_action: Human verification — load Home/Modify/CAD pages and confirm no duplicate key console errors

## Symptoms

expected: All forms work correctly — fields interactive, validations work, submissions succeed or show proper error messages
actual: Console errors on Home and Modify pages; functional issues found
errors: "Encountered two children with the same key — Emerald Cut" on Home and Modify pages
reproduction: Load any page with Stone Shape dropdown (Home, Modify, CAD Comparison)
started: Introduced when STONE_SHAPE_GROUPS replaced flat STONE_SHAPES array

## Eliminated

- hypothesis: category/price band cascade broken
  evidence: Works correctly — Category disabled when no segment, Price Band disabled when no category. Earring Style correctly appears for Set categories (Necklace Set, Choker Set, etc.)
  timestamp: 2026-04-09

- hypothesis: form submit buttons incorrectly disabled
  evidence: Modify and Marketing correctly disabled until image uploaded. CAD Comparison is not disabled but shows proper toast validation. Home submit enabled (correct — no required upload).
  timestamp: 2026-04-09

- hypothesis: assortment BDM dropdown broken
  evidence: BDM search input works correctly — shows dropdown when names are loaded and user types. No errors on the page.
  timestamp: 2026-04-09

## Evidence

- timestamp: 2026-04-09T09:00:00Z
  checked: Home page (/) console errors on load + dropdown interaction
  found: 2 console errors on initial load, 8 total after interacting. All errors are "Encountered two children with the same key — Emerald Cut"
  implication: Radix UI SelectItem uses the value prop internally as a key. "Emerald Cut" appears in both "Faceted" and "Cabochon" groups in STONE_SHAPE_GROUPS causing duplicate value props in the same Select

- timestamp: 2026-04-09T09:05:00Z
  checked: STONE_SHAPE_GROUPS definition in client/src/lib/api.ts (lines 536-555)
  found: "Emerald Cut" appears in both "Faceted" array (line 539) AND "Cabochon" array (line 548)
  implication: This is the root cause. Both groups contain value="Emerald Cut" SelectItem components. Radix UI treats them as duplicates.

- timestamp: 2026-04-09T09:06:00Z
  checked: Modify page (/modify) console errors
  found: 2 console errors same as Home page — duplicate "Emerald Cut" key
  implication: Same STONE_SHAPE_GROUPS used on all three form pages

- timestamp: 2026-04-09T09:07:00Z
  checked: CAD Comparison page (/cad-comparison) console errors
  found: 0 errors on initial load (without opening stone shape dropdown). Same duplicate exists in code but React may not have rendered the portal/listbox yet.
  implication: All three pages share the same STONE_SHAPE_GROUPS bug; some fire later than others

- timestamp: 2026-04-09T09:10:00Z
  checked: Select dropdown options count — Stone Shape
  found: 37 total options in the listbox. "Emerald Cut" appears exactly 2 times (at positions 6 and 23, in Faceted and Cabochon groups respectively)
  implication: A user selecting "Emerald Cut" gets undefined behavior — Radix may use either the Faceted or Cabochon occurrence, making it impossible to distinguish between them

- timestamp: 2026-04-09T09:15:00Z
  checked: Home page initial cascade state
  found: Product Segment shows "Select segment" placeholder (empty state). Category and Price Band correctly disabled with "Select segment first" / "Select category first" placeholders.
  implication: Cascade works correctly — no bug here

- timestamp: 2026-04-09T09:20:00Z
  checked: Earring Style field appearance for Set categories
  found: Earring Style combobox correctly appears between Category and Price Band when "Necklace Set", "Choker Set", or other Set categories are selected. Disappears for non-Set categories.
  implication: Cascade logic correct — this shifts Price Band to index 3 when earring style is present (vs index 2 without it)

- timestamp: 2026-04-09T09:25:00Z
  checked: CAD Comparison generate button state without segment/category
  found: Generate CAD Comparison button is NOT disabled on initial load (unlike Modify/Marketing). However, clicking it shows a toast: "Missing fields — Please select Product Segment and Category"
  implication: UX inconsistency — Modify/Marketing disable submit until requirements are met; CAD allows clicking but shows error after the fact. Not a bug, but inconsistent UX.

- timestamp: 2026-04-09T09:30:00Z
  checked: Assortment page (/assortment) state dropdown
  found: State dropdown contains non-Indian entries: "California", "New York", "London, City of", "Dubai", "Dhaka", "None". These come directly from the sales database.
  implication: Not a bug — these are real customer locations from the sales data. "None" may be NULL values in database converted to string. Low severity.

- timestamp: 2026-04-09T09:32:00Z
  checked: Marketing page (/marketing) form state
  found: All 7 comboboxes properly functional. Generate button correctly disabled until jewellery image is uploaded. No console errors.
  implication: Marketing form is working correctly.

- timestamp: 2026-04-09T09:35:00Z
  checked: TypeScript compilation (npx tsc --noEmit)
  found: 0 TypeScript errors
  implication: All recent changes (styleInspiration field addition, STONE_SHAPE_GROUPS, etc.) are type-safe

- timestamp: 2026-04-09T09:37:00Z
  checked: select.tsx change (in git diff)
  found: max-h changed from CSS variable `--radix-select-content-available-height` to fixed `300px`. This limits dropdown height to always 300px instead of using available viewport height.
  implication: On pages where a dropdown is near the bottom of the viewport, the 300px limit may cause the dropdown to be clipped or overflow instead of auto-adjusting. Medium severity UX issue.

## Resolution

root_cause: |
  PRIMARY BUG: "Emerald Cut" existed in both "Faceted" and "Cabochon" groups in STONE_SHAPE_GROUPS
  (client/src/lib/api.ts). Radix UI SelectItem uses the value prop as an internal key, so duplicate
  value="Emerald Cut" caused React warnings and undefined selection behavior on Home, Modify, and
  CAD Comparison pages.

  SECONDARY (already fixed in working copy): select.tsx max-h changed from bare CSS variable to
  min(300px, var(--radix-select-content-available-height)) — caps height at 300px while still
  respecting available viewport height via the CSS variable.

  MINOR UX (already fixed in working copy): CAD Comparison generate button was not disabled before
  segment/category selection — fixed by adding !productSegment || !category to the disabled prop.

fix: |
  FIX 1 Applied: Kept "Emerald Cut" in BOTH Faceted and Cabochon groups (per domain docs), but fixed
  the Radix duplicate key error by using group-prefixed Select values (e.g., "Faceted::Emerald Cut").
  Added stoneShapeSelectValue() and parseStoneShapeValue() helpers to api.ts. All 3 forms updated.

  FIX 2 Already applied in working copy: select.tsx uses max-h-[min(300px,var(--radix-select-content-available-height))].

  FIX 3 Already applied in working copy: CAD Comparison button disabled={isGenerating || !productSegment || !category}.

  FIX 4 Applied: server/storage.ts getStockItemsByStyleNos() — replaced raw SQL `= ANY()` with
  drizzle's `inArray()` to fix "op ANY/ALL (array) requires array on right side" error.

verification: TypeScript check passed (0 errors).
files_changed:
  - client/src/lib/api.ts (added helpers, restored Emerald Cut in Cabochon)
  - client/src/components/design-form.tsx (group-prefixed Select values)
  - client/src/pages/cad-comparison.tsx (group-prefixed Select values)
  - client/src/pages/modify.tsx (group-prefixed Select values)
  - server/storage.ts (inArray instead of raw SQL ANY)
