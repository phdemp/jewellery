export type DesignRequest = {
  productSegment?: string;
  category: string;
  priceBand?: string;
  polkiSize?: string[];
  polkiSetting?: string;
  motifCategory?: string[];
  motifs: string[];
  stoneName?: string[];
  stoneNameColour?: string[];
  stoneShape?: string;
  stoneSetting?: string;
  diamondSetting?: string;
  enamel?: string;
  finish?: string;
  designShape?: string;
  styleInspiration?: string;
  designType?: string;
  techniques?: string[];
  earringStyle?: string;
  materialRatio?: string;
  talaf?: string;
  piroiPlacement?: string;
  piroiColour?: string;
  goldRatePerGram?: number;
  goldPurity?: string;
  goldPercentage?: number;
  customNotes?: string;
  mode?: "sketch" | "cad";
};

export type DesignResponse = {
  sketchPlan: string;
  imagePrompt: string;
};


export const CATEGORIES = [
  "Long Necklace Set", "Choker", "Necklace", "Bangle", "Hathphool", 
  "Bracelet", "Ring", "Kantha", "Brooch", "Kalangi", 
  "Ear Extensions", "Maangtika", "Sheesh Patti", "Buttons", "Nath", "Lapel Pin"
];

// Theme definitions with display names and prompt-friendly values (without abbreviations)
export const THEME_OPTIONS = [
  { display: "Wearable - Daily (WRD)", value: "Wearable Daily" },
  { display: "Wearable - Occasional (WRO)", value: "Wearable Occasional" },
  { display: "Collectable - Occasional (CLO)", value: "Collectable Occasional" },
  { display: "Solitaire - Daily (SOLD)", value: "Solitaire Daily" },
  { display: "Solitaire - Occasional (SOLO)", value: "Solitaire Occasional" },
  { display: "Solitaire - Premium (SOLP)", value: "Solitaire Premium" },
  { display: "Bridal - Classic (BRC)", value: "Bridal Classic" },
  { display: "Bridal - Premium (BRP)", value: "Bridal Premium" },
  { display: "Bridal - Unique (BRU)", value: "Bridal Unique" },
];

// Keep THEMES array for backward compatibility (used for display)
export const THEMES = THEME_OPTIONS.map(t => t.display);

// Helper to get prompt-friendly theme value from display name
export function getThemePromptValue(displayName: string): string {
  const theme = THEME_OPTIONS.find(t => t.display === displayName);
  return theme ? theme.value : displayName;
}

export const MOTIF_GROUPS: Record<string, string[]> = {
  "Nature-Inspired": ["Lotus", "Paan", "Paisley", "Leaves", "Cluster Flowers"],
  "Animal & Birds": ["Swan", "Parrot", "Peacock", "Elephant", "Butterfly"],
  "Contemporary Luxury": ["Art Deco", "Scallop", "Ribbons", "Jaali Pattern"],
  "Forms & Shapes": ["Geometric", "Ovals", "Marquise", "Domes & Arches", "Curves", "Pears"],
  "Celestial & Spiritual": ["Crescent Moon", "Om", "Kalash"]
};

export const MOTIFS = Object.values(MOTIF_GROUPS).flat();

export const PRICE_RANGE_OPTIONS = [
  { display: "Up to 8 Lakhs", value: "Up to 8 Lakhs - Polki-filled design with gold as thin bezels only" },
  { display: "15+ Lakhs", value: "15+ Lakhs Premium - Dense polki coverage with intricate kundan work, gold visible only as fine bezels" },
];

export const MATERIAL_RATIOS = PRICE_RANGE_OPTIONS.map(p => p.display);

export function getPriceRangePromptValue(displayName: string): string {
  const priceRange = PRICE_RANGE_OPTIONS.find(p => p.display === displayName);
  return priceRange ? priceRange.value : displayName;
}

export const STONES = [
  "Polki",
  "Emerald",
  "Rubies", 
  "Sapphires",
  "Pink Tourmaline",
  "Navratna",
  "Amethyst"
];

export const STYLE_INSPIRATIONS: Record<string, string[]> = {
  "Global Styles": ["Cartier", "Bvlgari", "Van Cleef & Arpels", "Harry Winston", "Chaumet", "Graff"],
  "Indian Styles": ["Sabyasachi Jewellery", "Amrapali Jewels", "Tanishq", "Kalyan Jewellers"],
  "Generic Styles": ["Royal / Heritage", "Contemporary Minimal", "Bold Statement", "Floral / Nature-Inspired", "Temple Jewellery", "Fusion (Modern + Traditional)"],
};

export const PRICE_RANGES = [
  "Up to 8L", "15L+", "Premium"
];
