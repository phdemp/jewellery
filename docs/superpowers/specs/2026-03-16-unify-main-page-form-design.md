# Unify Main Page Form with CAD/Modify Form Fields

**Date:** 2026-03-16
**Status:** Approved

## Problem

The main page (Design Studio) form has 6 simplified fields (Category, Theme, Price Range, Motifs, Stones, Custom Notes) while the CAD Comparison and Modify pages use a richer form with cascading dropdowns (Product Segment -> Category -> Price Band), plus Polki Size, Motif Category, Stone Colour, Enamel, Finish, Design Shape, Material Ratio, Talaf, Piroi Placement, and Piroi Colour. Users want the same comprehensive parameters everywhere.

## Solution

Replace the main page form entirely with the extended-field form used by CAD/Modify pages (14 design parameter fields + Custom Notes + Style Override upload). Update the API layer and backend to accept and use the new fields.

## Files to Modify

1. `client/src/components/design-form.tsx` — full rewrite of form fields
2. `client/src/lib/jewellery-logic.ts` — update `DesignRequest` type, remove dead `generateDesignLogic()` function
3. `client/src/lib/api.ts` — update `generateDesign()` to send new fields via FormData
4. `client/src/pages/home.tsx` — update `handleGenerate` callback to match new `DesignRequest` type
5. `server/routes.ts` — update `POST /api/generate-design` to parse and use new fields

## Design Details

### 1. Frontend Form (`design-form.tsx`)

**Remove:** Category dropdown (flat 16-item list), Theme dropdown (9 WRD/WRO items), Price Range (2 items), Stones checkboxes (7 stone types).

**Add 14 design parameter fields + Custom Notes + Style Override:**

| # | Field | Control | Source |
|---|-------|---------|--------|
| 1 | Product Segment | Select dropdown | `SEGMENT_CATEGORY_PRICE_MAP` keys (from api.ts) |
| 2 | Category | Cascaded Select | Derived from selected Segment |
| 3 | Price Band | Cascaded Select | Derived from Segment + Category |
| 4 | Polki Size | Select dropdown | `["Far", "Big", "Normal"]` |
| 5 | Motif Category | Select dropdown | `["Animal & Bird", "Celestial & Spiritual", ...]` |
| 6 | Motifs | Grouped checkboxes | Local `MOTIF_GROUPS` constant (see note below) |
| 7 | Stone Colour | Multi checkboxes | `["Red Stone", "Green Stone", ...]` (10 items) |
| 8 | Enamel | Yes/No RadioGroup | Inline |
| 9 | Finish | Select dropdown | `["Yellow Gold Finish", "Light Antique", ...]` (8 items) |
| 10 | Design Shape | Select dropdown | `["Classic Choker", "Dog Band Choker", ...]` (17 items) |
| 11 | Material Ratio | Select dropdown | `["Polki Intensive", "Diamond Intensive", ...]` (5 items) |
| 12 | Talaf | Select dropdown | `["None", "Talaf-Red", ...]` (5 items) |
| 13 | Piroi Placement | Select dropdown | `["None", "Top", "Front", "Back", "Latkan"]` |
| 14 | Piroi Colour | Select dropdown | `["None", "Red", "Green", "Blue", "White", "Pink"]` |
| — | Custom Notes | Textarea | Free text |
| — | Style Override | Image upload (optional) | Kept from current form |

**Constants:** Define all constants locally in `design-form.tsx` — same values as `modify.tsx` and `cad-comparison.tsx`. Do NOT import `MOTIF_GROUPS` from `jewellery-logic.ts` because it has a different/smaller motif set (different group names and fewer motifs). The local `MOTIF_GROUPS` constant will use the extended set from `modify.tsx` with all motifs (e.g., "Animal & Bird" with 9 motifs including Bird, Horse, Tiger/Panther, Lion, etc.).

**Note on MOTIF_GROUPS divergence:** `jewellery-logic.ts` exports a smaller `MOTIF_GROUPS` (used by `comparison.tsx`). `modify.tsx` and `cad-comparison.tsx` each define a larger local `MOTIF_GROUPS`. This is a pre-existing inconsistency. The design-form will use the larger set from `modify.tsx`. We do NOT modify `jewellery-logic.ts`'s `MOTIF_GROUPS` to avoid breaking `comparison.tsx`.

**Cascading logic:** When Product Segment changes, reset Category and Price Band. When Category changes, reset Price Band. Same pattern as modify page.

**Form state:** Use `react-hook-form` with `useForm` (no Zod resolver needed — form-level validation checks that Product Segment and Category are non-empty before submit).

**`onSubmit` prop type changes** to accept the new extended `DesignRequest` interface.

### 2. API Layer

**`DesignRequest` type (`jewellery-logic.ts`):**

```typescript
export type DesignRequest = {
  productSegment?: string;
  category: string;
  priceBand?: string;
  polkiSize?: string;
  motifCategory?: string;
  motifs: string[];
  stoneColour?: string[];
  enamel?: string;
  finish?: string;
  designShape?: string;
  materialRatio?: string;
  talaf?: string;
  piroiPlacement?: string;
  piroiColour?: string;
  customNotes?: string;
  mode?: "sketch" | "cad";
};
```

Old fields (`theme`, `stones`, `referenceImage`) removed from this type. Old exports (`THEMES`, `THEME_OPTIONS`, `STONES`, `MATERIAL_RATIOS`, `getThemePromptValue`, `getPriceRangePromptValue`, etc.) kept in `jewellery-logic.ts` because `comparison.tsx` still imports them.

**Remove `generateDesignLogic()` function** from `jewellery-logic.ts`. It references old `DesignRequest` fields (`theme`, `stones`) and is dead code — the backend builds sketch plans inline in `routes.ts`, not via this function. Removing it prevents compile errors from the type change.

**`generateDesign()` function (`api.ts`):**

Update to send all new fields via FormData. Explicit FormData key mapping:

```
FormData key       → Source field
─────────────────────────────────
productSegment     → request.productSegment
category           → request.category
priceBand          → request.priceBand
polkiSize          → request.polkiSize
motifCategory      → request.motifCategory
motifs             → JSON.stringify(request.motifs)
stoneColour        → JSON.stringify(request.stoneColour)
enamel             → request.enamel
finish             → request.finish
designShape        → request.designShape
materialRatio      → request.materialRatio
talaf              → request.talaf
piroiPlacement     → request.piroiPlacement
piroiColour        → request.piroiColour
customNotes        → request.customNotes
mode               → request.mode ?? 'sketch'
styleOverride      → styleOverride file (if provided)
```

String fields: only append if non-empty. Array fields: only append if non-empty array.

### 3. Backend (`server/routes.ts` — `POST /api/generate-design`)

**Parse new fields** from `req.body`:
- `productSegment`, `category`, `priceBand`, `polkiSize`, `motifCategory` — string fields
- `motifs` — JSON.parse array
- `stoneColour` — JSON.parse array
- `enamel`, `finish`, `designShape`, `materialRatio`, `talaf`, `piroiPlacement`, `piroiColour`, `customNotes` — string fields

**Map to `DesignContext` + `designProjectInputSchema`** for prompt building and DB storage:
- `category` = `req.body.category`
- `theme` = `req.body.productSegment || "Modern"` — product segment replaces theme. This means the DB `theme` column will store product segment names (e.g., "Bridal", "Traditional") for new projects. Old projects retain their original theme names. This is acceptable — the column is used for display/reference, not for functional logic.
- `motifs` = parsed motifs array
- `stones` = parsed stoneColour array — stone colour names (e.g., "Red Stone", "Green Stone") will be stored in the DB `stones` column instead of stone type names (e.g., "Polki", "Emerald"). This is a semantic change in stored data but does not break any functionality.
- `materialRatio` = `req.body.materialRatio || "Gold Intensive"` — optional in the form but the DB column is `notNull()`, so we default to "Gold Intensive" if not provided.
- `customNotes` = `req.body.customNotes`

**Append extra specs to prompt** (same approach as CAD comparison endpoint):
Build an `extraSpecs` array from `priceBand`, `polkiSize`, `motifCategory`, `enamel`, `finish`, `designShape`, `talaf`, `piroiPlacement`, `piroiColour`. Append to the image prompt string before calling `generateJewellerySketch()`.

**RAG search** query text updated: `category + productSegment + motifs + customNotes`.

**Theme code mapping** for RAG filtering: no longer available (product segments don't map to THEME_CODES). Set `themeCode = null` — RAG search will not filter by theme, which broadens results (acceptable).

### 4. Home Page (`home.tsx`)

Update `handleGenerate` callback signature. The function receives `DesignRequest` which now has different fields. The `setLastCategory(data.category)` call still works since `category` exists in both old and new types. No other changes needed — the page just passes data through to `generateDesign()`.

## Data Semantics Change (DB)

After this change, new `design_projects` rows will have:
- `theme` column: stores product segment name (e.g., "Bridal") instead of theme code name (e.g., "Bridal Classic")
- `stones` column: stores stone colour names (e.g., `["Red Stone", "Green Stone"]`) instead of stone type names (e.g., `["Polki", "Emerald"]`)

This is a semantic shift but does not break any functionality. The `comparison.tsx` page and `ResultDisplay` display these as labels, which will show the new values for new projects and old values for old projects.

## What Does NOT Change

- `modify.tsx` — unchanged
- `cad-comparison.tsx` — unchanged
- `comparison.tsx` — unchanged (still uses old THEMES/STONES constants from jewellery-logic.ts)
- `server/google-client.ts` — unchanged (buildImagePrompt, buildDesignContext work with the same DesignContext interface)
- `shared/schema.ts` — unchanged (designProjectInputSchema still validates category/theme/motifs/stones/materialRatio for DB storage; theme is mapped from productSegment, stones from stoneColour)
- `ResultDisplay` component — unchanged
- Style override feature — preserved

## Verification

1. `npm run check` — no TypeScript errors
2. Main page form renders all 14 design parameter fields with correct cascading
3. Generating a design sends all fields to backend
4. Generated sketch incorporates the new parameters (visible in imagePrompt)
5. Comparison page still works with its old form
6. Style override upload still works on main page
