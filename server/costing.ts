// ─── Stone & Gold Pricing Data (server-side) ────────────────────────────────

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
    { type: "Synthetic",          price: 200  },
    { type: "Morganite",          price: 600  },
    { type: "Emerald",            price: 2000 },
    { type: "Emerald Russian",    price: 3500 },
    { type: "Emerald Colombian",  price: 6000 },
    { type: "Navratna",           price: 300  },
    { type: "Ruby",               price: 2500 },
    { type: "Ruby Glass Filled",  price: 400  },
    { type: "Sapphire",           price: 2000 },
    { type: "Aquamarine",         price: 800  },
    { type: "Tourmaline",         price: 1000 },
    { type: "Amethyst",           price: 400  },
    { type: "Turquoise",          price: 500  },
    { type: "Tanzanite",          price: 3000 },
    { type: "Spinel",             price: 1500 },
    { type: "Opal",               price: 1200 },
    { type: "Coral",              price: 600  },
    { type: "Aventurian",         price: 200  },
    { type: "Beryl",              price: 800  },
    { type: "Floride",            price: 200  },
    { type: "Onyx",               price: 300  },
    { type: "Hydro",              price: 200  },
    { type: "Green Strawberry",   price: 400  },
    { type: "Nano Semi Precious", price: 200  },
    { type: "Pearl",              price: 800  },
    { type: "Basra Pearl",        price: 5000 },
    { type: "JKC Pearl",          price: 1200 },
    { type: "South Sea Pearl",    price: 8000 },
  ],
  emerald: [
    { size_mm: "3x2",   weight: 0.12  },
    { size_mm: "3.5x2", weight: 0.144 },
    { size_mm: "4x2",   weight: 0.18  },
    { size_mm: "4x3",   weight: 0.24  },
  ],
} as const;

export const GOLD_PURITY = {
  "9k":  9  / 24,
  "14k": 14 / 24,
  "18k": 18 / 24,
  "22k": 22 / 24,
} as const;

/** Raniwala standard making charge: ₹1,200 per gram of gold */
export const MAKING_CHARGE_RATE = 1200;

export type GoldPurity = keyof typeof GOLD_PURITY;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PolkiEntry { sieve: string; count: number; }
export interface DiamondEntry { sieve: string; count: number; }
export interface ColorStoneEntry { type: string; carats: number; }
export interface EmeraldEntry { size_mm: string; count: number; }

export interface CostingInput {
  totalBudget: number;
  goldPercentage: number;
  goldRatePerGram: number;
  goldPurity: GoldPurity;
  goldWeightGrams?: number;   // override: AI-estimated actual gold weight
  polki: PolkiEntry[];
  diamond: DiamondEntry[];
  colorStones: ColorStoneEntry[];
  emeralds: EmeraldEntry[];
}

export interface PolkiLineItem {
  sieve: string; size_mm: string; count: number;
  weightPerPiece: number; totalWeight: number;
  ratePerGram: number; totalCost: number;
}
export interface DiamondLineItem {
  sieve: string; size_mm: string; count: number;
  weightPerPiece: number; totalCarats: number;
  ratePerCarat: number; totalCost: number;
}
export interface ColorStoneLineItem {
  type: string; carats: number;
  ratePerCarat: number; totalCost: number;
}
export interface EmeraldLineItem {
  size_mm: string; count: number;
  weightPerPiece: number; totalCarats: number;
  ratePerCarat: number; totalCost: number;
}
export interface GoldResult {
  purity: GoldPurity; purityFraction: number;
  budgetAllocated: number; ratePerGram: number;
  effectiveRatePerGram: number; estimatedWeight: number;
  totalCost: number;
}

export interface CostingReport {
  input: CostingInput;
  goldBudget: number;
  stoneBudget: number;
  gold: GoldResult;
  makingCharges: number;        // goldWeight × MAKING_CHARGE_RATE
  polki: PolkiLineItem[];
  diamond: DiamondLineItem[];
  colorStones: ColorStoneLineItem[];
  emeralds: EmeraldLineItem[];
  totalStoneCost: number;
  totalEstimatedCost: number;   // gold + making + stones
  budgetVariance: number;
  generatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round3(n: number): number {
  return parseFloat(n.toFixed(3));
}

// ─── Calculation Functions ───────────────────────────────────────────────────

export function splitBudget(totalBudget: number, goldPercentage: number) {
  const goldBudget = Math.round(totalBudget * goldPercentage / 100);
  const stoneBudget = Math.round(totalBudget * (100 - goldPercentage) / 100);
  return { goldBudget, stoneBudget };
}

export function calculateGold(
  goldBudget: number, goldRatePerGram: number, purity: GoldPurity
): GoldResult {
  const purityFraction = GOLD_PURITY[purity];
  const effectiveRatePerGram = Math.round(goldRatePerGram * purityFraction);
  const estimatedWeight = effectiveRatePerGram > 0
    ? round3(goldBudget / effectiveRatePerGram) : 0;
  return {
    purity, purityFraction, budgetAllocated: goldBudget,
    ratePerGram: goldRatePerGram, effectiveRatePerGram,
    estimatedWeight, totalCost: goldBudget,
  };
}

export function calculatePolki(entries: PolkiEntry[]): PolkiLineItem[] {
  return entries.flatMap(entry => {
    const data = STONE_DATA.polki.find(p => p.sieve === entry.sieve);
    if (!data) return [];
    const totalWeight = round3(entry.count * data.weight);
    const totalCost = Math.round(entry.count * data.weight * data.cost);
    return [{
      sieve: data.sieve as string, size_mm: data.size_mm as string,
      count: entry.count, weightPerPiece: data.weight as number,
      totalWeight, ratePerGram: data.cost as number, totalCost,
    }];
  });
}

export function calculateDiamond(entries: DiamondEntry[]): DiamondLineItem[] {
  return entries.flatMap(entry => {
    const data = STONE_DATA.diamond.find(d => d.sieve === entry.sieve);
    if (!data) return [];
    const totalCarats = round3(entry.count * data.weight);
    const totalCost = Math.round(entry.count * data.weight * data.cost);
    return [{
      sieve: data.sieve as string, size_mm: data.size_mm as string,
      count: entry.count, weightPerPiece: data.weight as number,
      totalCarats, ratePerCarat: data.cost as number, totalCost,
    }];
  });
}

export function calculateColorStones(entries: ColorStoneEntry[]): ColorStoneLineItem[] {
  return entries.flatMap(entry => {
    const data = STONE_DATA.colorStone.find(c => c.type === entry.type);
    if (!data) return [];
    return [{
      type: entry.type, carats: round3(entry.carats),
      ratePerCarat: data.price as number,
      totalCost: Math.round(entry.carats * data.price),
    }];
  });
}

export function calculateEmeralds(entries: EmeraldEntry[]): EmeraldLineItem[] {
  const emeraldRate = STONE_DATA.colorStone.find(c => c.type === "Emerald")!.price as number;
  return entries.flatMap(entry => {
    const data = STONE_DATA.emerald.find(e => e.size_mm === entry.size_mm);
    if (!data) return [];
    const totalCarats = round3(entry.count * data.weight);
    const totalCost = Math.round(entry.count * data.weight * emeraldRate);
    return [{
      size_mm: data.size_mm as string, count: entry.count,
      weightPerPiece: data.weight as number, totalCarats,
      ratePerCarat: emeraldRate, totalCost,
    }];
  });
}

export function generateCostingReport(input: CostingInput): CostingReport {
  const { goldBudget, stoneBudget } = splitBudget(input.totalBudget, input.goldPercentage);

  // Always use budget-driven gold allocation (AI sketch weight is unreliable for manufacturing cost)
  const gold = calculateGold(goldBudget, input.goldRatePerGram, input.goldPurity);

  // Making charges: ₹1,200 per gram (standard Raniwala rate)
  const makingCharges = Math.round(gold.estimatedWeight * MAKING_CHARGE_RATE);

  const polki = calculatePolki(input.polki);
  const diamond = calculateDiamond(input.diamond);
  const colorStones = calculateColorStones(input.colorStones);
  const emeralds = calculateEmeralds(input.emeralds);

  const totalStoneCost =
    polki.reduce((s, i) => s + i.totalCost, 0) +
    diamond.reduce((s, i) => s + i.totalCost, 0) +
    colorStones.reduce((s, i) => s + i.totalCost, 0) +
    emeralds.reduce((s, i) => s + i.totalCost, 0);

  const totalEstimatedCost = gold.totalCost + makingCharges + totalStoneCost;
  const budgetVariance = totalEstimatedCost - input.totalBudget;

  return {
    input, goldBudget, stoneBudget, gold, makingCharges,
    polki, diamond, colorStones, emeralds,
    totalStoneCost, totalEstimatedCost, budgetVariance,
    generatedAt: new Date().toISOString(),
  };
}
