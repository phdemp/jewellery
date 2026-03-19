# TODO: Design Cost Estimator — Gold Slider + Stone Breakdown Report

> Feed this file with: `claude -p TODO_COSTING.md`
> Complete all tasks in order. This feature is added to the `/modify` page only.

---

## Overview

Add a cost estimator section below the result panel on the `/modify` page. The user sets a total budget, uses a slider to split it between gold and stones, enters today's gold rate, selects gold purity (14k / 18k / 22k), manually inputs stone quantities and sizes, and the tool generates a detailed cost breakdown report — showing gold weight + cost, per-stone counts + carats + cost, and total estimated value.

**Files to modify:**
- `client/src/pages/modify.tsx` — add the costing section below `ResultDisplay`
- `client/src/lib/api.ts` — add costing constants and types

**Files to create:**
- `client/src/components/cost-estimator.tsx` — the full estimator component
- `client/src/lib/costing-logic.ts` — all calculation logic, pure functions, no UI

**Files to leave untouched:**
- All server files — this feature is entirely client-side, no API calls needed
- `shared/schema.ts`, `server/routes.ts`, all other files

---

## TASK 1 — Create `client/src/lib/costing-logic.ts`

This file contains all calculation logic as pure TypeScript functions. No React, no UI imports.

### Stone pricing data — paste exactly as-is

```typescript
export const STONE_DATA = {
  polki: [
    { sieve: "8-10",  weight: 0.03,  cost: 10500, size_mm: "2–2.5" },
    { sieve: "10-12", weight: 0.04,  cost: 11500, size_mm: "2.5–3.3" },
    { sieve: "12-14", weight: 0.065, cost: 12500, size_mm: "3.3–4.1" },
    { sieve: "14-16", weight: 0.075, cost: 13250, size_mm: "4.1–5.3" },
  ],
  diamond: [
    { sieve: "00-0",  size_mm: "1.00", weight: 0.005, cost: 21000 },
    { sieve: "0-1",   size_mm: "1.10", weight: 0.006, cost: 21000 },
    { sieve: "1-1.5", size_mm: "1.20", weight: 0.008, cost: 21000 },
    { sieve: "2-2.5", size_mm: "1.30", weight: 0.01,  cost: 21000 },
  ],
  colorStone: [
    { type: "Synthetic", price: 200  },
    { type: "Morganite", price: 200  },
    { type: "Emerald",   price: 2000 },
    { type: "Navratna",  price: 200  },
    { type: "Ruby",      price: 2000 },
  ],
  emerald: [
    { size_mm: "3x2",   weight: 0.12  },
    { size_mm: "3.5x2", weight: 0.144 },
    { size_mm: "4x2",   weight: 0.18  },
    { size_mm: "4x3",   weight: 0.24  },
  ],
} as const;

// Gold purity multipliers — fraction of pure gold per gram
export const GOLD_PURITY = {
  "14k": 14 / 24,   // 58.3%
  "18k": 18 / 24,   // 75.0%
  "22k": 22 / 24,   // 91.7%
} as const;

export type GoldPurity = keyof typeof GOLD_PURITY;
```

---

### Types

```typescript
export interface PolkiEntry {
  sieve: string;       // e.g. "8-10"
  count: number;       // how many pieces
}

export interface DiamondEntry {
  sieve: string;       // e.g. "00-0"
  count: number;
}

export interface ColorStoneEntry {
  type: string;        // e.g. "Emerald"
  carats: number;      // total carats for this stone type
}

export interface EmeraldEntry {
  size_mm: string;     // e.g. "3x2"
  count: number;
}

export interface CostingInput {
  totalBudget: number;          // in INR
  goldPercentage: number;       // 0–100, slider value
  goldRatePerGram: number;      // user-entered today's rate in INR
  goldPurity: GoldPurity;       // "14k" | "18k" | "22k"
  polki: PolkiEntry[];
  diamond: DiamondEntry[];
  colorStones: ColorStoneEntry[];
  emeralds: EmeraldEntry[];
}

export interface PolkiLineItem {
  sieve: string;
  size_mm: string;
  count: number;
  weightPerPiece: number;       // grams
  totalWeight: number;          // grams
  ratePerGram: number;          // INR/gram from STONE_DATA
  totalCost: number;            // INR
}

export interface DiamondLineItem {
  sieve: string;
  size_mm: string;
  count: number;
  weightPerPiece: number;       // carats
  totalCarats: number;
  ratePerCarat: number;         // INR/ct from STONE_DATA
  totalCost: number;
}

export interface ColorStoneLineItem {
  type: string;
  carats: number;
  ratePerCarat: number;
  totalCost: number;
}

export interface EmeraldLineItem {
  size_mm: string;
  count: number;
  weightPerPiece: number;       // carats
  totalCarats: number;
  // Emerald priced as color stone "Emerald" rate
  ratePerCarat: number;
  totalCost: number;
}

export interface GoldResult {
  purity: GoldPurity;
  purityFraction: number;       // e.g. 0.75 for 18k
  budgetAllocated: number;      // INR allocated to gold from slider
  ratePerGram: number;          // user-entered
  effectiveRatePerGram: number; // ratePerGram * purityFraction
  estimatedWeight: number;      // grams = budgetAllocated / effectiveRatePerGram
  totalCost: number;            // = budgetAllocated (gold cost equals allocation)
}

export interface CostingReport {
  input: CostingInput;
  goldBudget: number;           // INR
  stoneBudget: number;          // INR
  gold: GoldResult;
  polki: PolkiLineItem[];
  diamond: DiamondLineItem[];
  colorStones: ColorStoneLineItem[];
  emeralds: EmeraldLineItem[];
  totalStoneCost: number;       // sum of all stone line items
  totalEstimatedCost: number;   // gold + all stones
  budgetVariance: number;       // totalEstimatedCost - totalBudget (+ = over, - = under)
  generatedAt: string;          // ISO timestamp
}
```

---

### Calculation functions

```typescript
// Split the total budget by slider percentage
export function splitBudget(totalBudget: number, goldPercentage: number): {
  goldBudget: number;
  stoneBudget: number;
}

// Calculate gold result from allocation and user rate
export function calculateGold(
  goldBudget: number,
  goldRatePerGram: number,
  purity: GoldPurity
): GoldResult

// Calculate polki line items
// ratePerGram in STONE_DATA.polki is cost per gram of polki
export function calculatePolki(entries: PolkiEntry[]): PolkiLineItem[]

// Calculate diamond line items
// cost in STONE_DATA.diamond is per carat (weight is in carats)
export function calculateDiamond(entries: DiamondEntry[]): DiamondLineItem[]

// Calculate colour stone line items
// price in STONE_DATA.colorStone is per carat
export function calculateColorStones(entries: ColorStoneEntry[]): ColorStoneLineItem[]

// Calculate emerald line items
// Use "Emerald" price from STONE_DATA.colorStone (₹2,000/ct) as the rate
// STONE_DATA.emerald gives weight in carats per piece
export function calculateEmeralds(entries: EmeraldEntry[]): EmeraldLineItem[]

// Master function — runs all calculations and assembles the full report
export function generateCostingReport(input: CostingInput): CostingReport
```

**Implement all functions with the following rules:**
- Round all currency values to nearest integer using `Math.round()`
- Round weights to 3 decimal places using `.toFixed(3)` before storing (parse back to number)
- Round carats to 3 decimal places
- `budgetVariance` = `totalEstimatedCost - totalBudget` — positive means over budget, negative means under
- `generatedAt` = `new Date().toISOString()`
- If an entry array is empty, return an empty array — never throw

---

## TASK 2 — Create `client/src/components/cost-estimator.tsx`

This is the full self-contained React component. It receives no props — all state is internal.

### State

```typescript
// Budget & gold
const [totalBudget, setTotalBudget] = useState<number>(500000)
const [goldPercentage, setGoldPercentage] = useState<number>(40)
const [goldRatePerGram, setGoldRatePerGram] = useState<number>(7000)
const [goldPurity, setGoldPurity] = useState<GoldPurity>("18k")

// Stone entries
const [polkiEntries, setPolkiEntries] = useState<PolkiEntry[]>([])
const [diamondEntries, setDiamondEntries] = useState<DiamondEntry[]>([])
const [colorStoneEntries, setColorStoneEntries] = useState<ColorStoneEntry[]>([])
const [emeraldEntries, setEmeraldEntries] = useState<EmeraldEntry[]>([])

// Report
const [report, setReport] = useState<CostingReport | null>(null)
const [reportVisible, setReportVisible] = useState(false)
```

---

### Layout — four sections stacked vertically inside a card

```
┌─────────────────────────────────────────────┐
│  Section 1: Budget & Gold Setup              │
│  Section 2: Stone Input Tables               │
│  Section 3: Generate Report button           │
│  Section 4: Report output (appears on gen)   │
└─────────────────────────────────────────────┘
```

---

### Section 1 — Budget & Gold Setup

**Total Budget field**
- Number input, label: `"Total Budget (₹)"`
- Format with thousands separator on display using `toLocaleString("en-IN")`
- Minimum: 50000, no maximum

**Gold / Stone split slider**
- A single range slider (`<input type="range" min={0} max={100} step={1}`)
- Label above: `"Gold vs Stone Allocation"`
- Live display below the slider showing two values side by side:
  - Left: `"Gold — {goldPercentage}% — ₹{goldBudget.toLocaleString('en-IN')}"`
  - Right: `"Stones — {100 - goldPercentage}% — ₹{stoneBudget.toLocaleString('en-IN')}"`
- Both values update in real-time as slider moves
- Use amber/gold colour for the gold side label, blue/teal for the stone side label

**Gold Rate field**
- Number input, label: `"Today's Gold Rate (₹ per gram)"`
- Placeholder: `"e.g. 7000"`
- Small muted helper text below: `"Enter the current 24k gold rate per gram"`

**Gold Purity selector**
- Three pill buttons: `14k` / `18k` / `22k`
- Selected pill has amber/gold background, unselected are outlined
- Below the pills, show a live calculated line:
  `"Estimated gold weight: {estimatedGoldWeight}g at {purity} purity"`
- Calculate: `estimatedGoldWeight = goldBudget / (goldRatePerGram * GOLD_PURITY[purity])`
- Round to 2 decimal places

---

### Section 2 — Stone Input Tables

Four sub-sections, one per stone type. Each has a heading, a table of rows, and an "Add row" button.

#### 2A — Polki

Table columns: `Sieve Size` | `Count` | `Weight/piece (g)` | `Cost/g (₹)` | `Line Total (₹)` | `Remove`

- `Sieve Size` — `<Select>` populated from `STONE_DATA.polki` — show `"{sieve} ({size_mm}mm)"`
- `Count` — number input, min 1
- `Weight/piece` and `Cost/g` — auto-filled from `STONE_DATA.polki` when sieve is selected, read-only display
- `Line Total` — live calculated: `count × weight × cost` (cost is per gram in data) — show as `₹{n.toLocaleString('en-IN')}`
- Remove button — removes that row

"Add Polki" button appends a new blank row with the first sieve pre-selected.

#### 2B — Diamond

Table columns: `Sieve Size` | `Count` | `Weight/piece (ct)` | `Rate/ct (₹)` | `Line Total (₹)` | `Remove`

- `Sieve Size` — `<Select>` from `STONE_DATA.diamond` — show `"{sieve} ({size_mm}mm)"`
- `Count` — number input
- `Weight/piece` and `Rate/ct` — auto-filled, read-only
- `Line Total` — `count × weight × cost` (cost is per carat)
- Remove button

"Add Diamond" button appends a new blank row.

#### 2C — Colour Stones

Table columns: `Stone Type` | `Carats` | `Rate/ct (₹)` | `Line Total (₹)` | `Remove`

- `Stone Type` — `<Select>` from `STONE_DATA.colorStone` — show type name
- `Carats` — number input, step 0.01
- `Rate/ct` — auto-filled from `STONE_DATA.colorStone[selected].price`, read-only
- `Line Total` — `carats × rate`
- Remove button

"Add Colour Stone" button appends a new blank row.

#### 2D — Emeralds (sized)

Table columns: `Size` | `Count` | `Weight/piece (ct)` | `Rate/ct (₹)` | `Line Total (₹)` | `Remove`

- `Size` — `<Select>` from `STONE_DATA.emerald` — show size_mm value
- `Count` — number input
- `Weight/piece` — auto-filled from `STONE_DATA.emerald[selected].weight`, read-only
- `Rate/ct` — always ₹2,000 (Emerald rate from `STONE_DATA.colorStone`), read-only
- `Line Total` — `count × weight × 2000`
- Remove button

"Add Emerald" button appends a new blank row.

---

### Live running totals bar

Sticky bar above the "Generate Report" button showing four values in a row:
```
Gold: ₹X,XX,XXX   |   Stones: ₹X,XX,XXX   |   Total: ₹X,XX,XXX   |   Budget: ₹X,XX,XXX
```
Update in real time as any input changes. Colour the `Total` value:
- Green if total ≤ budget
- Amber if total is within 10% over budget
- Red if total is more than 10% over budget

---

### Section 3 — Generate Report button

Button label: `"Generate Cost Report"`
- Calls `generateCostingReport(input)` from `costing-logic.ts`
- Sets `report` state
- Sets `reportVisible = true`
- Scrolls to the report section

Validation before generating:
- `totalBudget` must be > 0
- `goldRatePerGram` must be > 0
- Show toast error if either is missing

---

### Section 4 — Report Output

Only render when `report !== null && reportVisible`.

#### Report header
```
RANIWALA 1881 — Design Cost Estimate
Generated: {formattedDate}
```

#### Summary cards — 4 in a row
- Gold Budget Allocated: `₹X,XX,XXX`
- Stone Budget Allocated: `₹X,XX,XXX`
- Total Estimated Cost: `₹X,XX,XXX`
- Budget Variance: `₹X,XX,XXX` (show `+ over` in red or `- under` in green)

#### Gold detail block
```
Gold Specification
─────────────────────────────────────
Purity:              {purity} ({purityFraction * 100}% pure)
Today's Rate:        ₹{goldRatePerGram}/gram (24k)
Effective Rate:      ₹{effectiveRatePerGram}/gram ({purity})
Budget Allocated:    ₹{goldBudget}
Estimated Weight:    {estimatedWeight}g
```

#### Stone breakdown tables

One table per stone type that has entries. Skip empty categories entirely.

**Polki table:**
| Sieve | Size | Count | Wt/piece | Total Wt | Rate/g | Line Total |
|-------|------|-------|----------|----------|--------|------------|

Row at bottom: **Polki Subtotal** — sum of line totals

**Diamond table:**
| Sieve | Size | Count | Wt/piece (ct) | Total (ct) | Rate/ct | Line Total |
|-------|------|-------|---------------|------------|---------|------------|

Row at bottom: **Diamond Subtotal**

**Colour Stone table:**
| Stone | Carats | Rate/ct | Line Total |
|-------|--------|---------|------------|

Row at bottom: **Colour Stone Subtotal**

**Emerald table:**
| Size | Count | Wt/piece (ct) | Total (ct) | Rate/ct | Line Total |
|------|-------|---------------|------------|---------|------------|

Row at bottom: **Emerald Subtotal**

#### Grand total row
```
─────────────────────────────────────────────────────────
Total Stone Cost:          ₹X,XX,XXX
Gold Cost:                 ₹X,XX,XXX
─────────────────────────────────────────────────────────
TOTAL ESTIMATED COST:      ₹X,XX,XXX
Total Budget:              ₹X,XX,XXX
Variance:                  ₹X,XX,XXX (over / under)
```

#### Action buttons below the report
- `"Download Report (PDF)"` — use `window.print()` targeting the report div with a print stylesheet, OR generate a simple HTML blob and trigger download. Use whichever is simpler.
- `"Recalculate"` — scrolls back to top of estimator, keeps all inputs intact
- `"Clear & Reset"` — resets all state to defaults

---

## TASK 3 — Add the component to `client/src/pages/modify.tsx`

Import and render `<CostEstimator />` below the `<ResultDisplay />` section on the modify page.

Add a section heading above it using the same heading style as other sections on the page:

```tsx
// After the result display grid:
<OrnamentalDivider />
<div className="..."> {/* same container class as the rest of the page */}
  <h2 className="...">Design Cost Estimator</h2>
  <p className="...">
    Estimate the material cost of your design — set your budget, split between
    gold and stones, and generate a detailed breakdown report.
  </p>
  <CostEstimator />
</div>
```

The `CostEstimator` component renders regardless of whether a design has been generated — it is a standalone tool on the page.

---

## TASK 4 — Print / PDF stylesheet

Add a `<style>` block or a separate CSS class for print targeting. When the user clicks "Download Report", only the report div should print — hide the rest of the page.

```css
@media print {
  /* Hide everything except the report */
  body > * { display: none !important; }
  #cost-report { display: block !important; }

  /* Clean print layout */
  #cost-report {
    font-family: Arial, sans-serif;
    font-size: 11pt;
    color: #000;
    padding: 20mm;
  }

  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f5f0e8; }
}
```

Give the report div `id="cost-report"`. The download button calls `window.print()`.

---

## TASK 5 — Type check

```bash
npm run check
```

Fix all TypeScript errors before considering this feature complete.

---

## Acceptance Criteria

- [ ] `CostEstimator` renders on the `/modify` page below the result section
- [ ] Total budget input and gold/stone slider update the live budget split in real time
- [ ] Gold rate input and purity selector update the estimated gold weight live
- [ ] All four stone tables render with correct dropdowns sourced from `STONE_DATA`
- [ ] Selecting a sieve/size auto-fills weight and rate fields (read-only)
- [ ] Line totals update live as count/carats change
- [ ] Running totals bar updates live and changes colour based on budget vs total
- [ ] "Generate Cost Report" calls `generateCostingReport()` and renders the full report
- [ ] Report shows gold spec block, per-stone tables with subtotals, and grand total
- [ ] Budget variance is shown correctly — positive (over) in red, negative (under) in green
- [ ] "Download Report" triggers `window.print()` showing only the report div
- [ ] "Clear & Reset" resets all state to defaults
- [ ] All currency values are formatted with `toLocaleString("en-IN")` — never raw numbers
- [ ] All weights and carats are rounded to 3 decimal places in the report
- [ ] `npm run check` passes with zero TypeScript errors
- [ ] Component is entirely client-side — no server calls, no new API endpoints

---

## Calculation Reference — Quick Check

Use these to verify your implementation is correct before testing in the UI.

**Gold check (18k, ₹7,000/g rate, ₹2,00,000 gold budget):**
- Purity fraction = 18/24 = 0.75
- Effective rate = 7,000 × 0.75 = ₹5,250/g
- Estimated weight = 2,00,000 / 5,250 = 38.095g ✓

**Polki check (sieve 12-14, 10 pieces):**
- Weight/piece = 0.065g, Cost = ₹12,500/g
- Line total = 10 × 0.065 × 12,500 = ₹8,125 ✓

**Diamond check (sieve 1-1.5, 20 pieces):**
- Weight/piece = 0.008ct, Rate = ₹21,000/ct
- Line total = 20 × 0.008 × 21,000 = ₹3,360 ✓

**Emerald check (size 4x3, 5 pieces):**
- Weight/piece = 0.24ct, Rate = ₹2,000/ct
- Line total = 5 × 0.24 × 2,000 = ₹2,400 ✓

**Colour stone check (Ruby, 1.5 carats):**
- Rate = ₹2,000/ct
- Line total = 1.5 × 2,000 = ₹3,000 ✓
