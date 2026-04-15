import * as Sentry from "@sentry/react";
import { DesignRequest } from "./jewellery-logic";

export interface ReferenceImage {
  id: string;
  filename: string;
  filepath?: string;
  thumbnailPath?: string;
  themeCode?: string;
  productSegment?: string;
  category?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  analysis?: {
    description: string;
    styleElements: string[];
    motifs: string[];
    structure: string;
    pieceType?: string;
  };
}

export interface ModelResult {
  imageUrl: string | null;
  error: string | null;
  model: string;
}

export interface DesignGenerationResponse {
  id: string;
  sketchPlan: string;
  imagePrompt: string;
  generatedImageUrl: string;
  usedReferences: number;
  gemini?: ModelResult;
  openai?: ModelResult;
  grok?: ModelResult;
  costReport?: CostingReportData | null;
}

export interface DesignProject {
  id: string;
  category: string;
  theme: string;
  motifs: string[];
  materialRatio: string;
  customNotes?: string;
  sketchPlan: string;
  imagePrompt: string;
  generatedImageUrl: string;
}

export async function uploadReferenceImage(
  file: File,
  themeCode?: string,
  productSegment?: string,
  category?: string
): Promise<ReferenceImage> {
  const formData = new FormData();
  formData.append('image', file);
  if (themeCode) formData.append('themeCode', themeCode);
  if (productSegment) formData.append('productSegment', productSegment);
  if (category) formData.append('category', category);

  const response = await fetch('/api/reference-images', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    const err = new Error(error.error || 'Failed to upload reference image');
    Sentry.captureException(err, { extra: { endpoint: '/api/reference-images', status: response.status } });
    throw err;
  }

  return response.json();
}

export const THEME_CODES = [
  { code: "WRD", name: "Wearable Daily" },
  { code: "WRO", name: "Wearable Occasional" },
  { code: "CLO", name: "Collectable Occasional" },
  { code: "SOD", name: "Solitaire Daily" },
  { code: "SOO", name: "Solitaire Occasional" },
  { code: "SOP", name: "Solitaire Premium" },
  { code: "BRC", name: "Bridal Classic" },
  { code: "BRP", name: "Bridal Premium" },
  { code: "BRU", name: "Bridal Unique" },
] as const;

export const REFERENCE_SEGMENTS = [
  "Bridal",
  "Bridal Lite",
  "Traditional",
  "Modern",
  "RTW",
  "Ear Essentials",
  "Handwear",
  "Add-ons",
  "Exclusive - Grandeur",
] as const;

export const REFERENCE_SEGMENT_CATEGORIES: Record<string, string[]> = {
  "Bridal": ["Choker", "Choker Set", "Earrings", "Necklace", "Necklace Set", "Long Pendant", "Long Pendant Set", "Long Necklace", "Long Necklace Set"],
  "Bridal Lite": ["Choker", "Choker Set", "Earrings", "Necklace", "Necklace Set", "Long Pendant", "Long Pendant Set", "Long Necklace", "Long Necklace Set"],
  "Traditional": ["Choker", "Choker Set", "Earrings", "Necklace", "Necklace Set", "Long Pendant", "Long Pendant Set", "Long Necklace", "Long Necklace Set"],
  "Modern": ["Choker", "Choker Set", "Necklace", "Necklace Set", "Long Necklace", "Long Necklace Set"],
  "RTW": ["Chain Necklace", "Chain Necklace Set", "Pendant", "Pendant Set"],
  "Ear Essentials": ["Earrings", "Studs", "Drops", "Hoops"],
  "Handwear": ["Bracelet", "Bangle", "Hathphool", "Ring"],
  "Add-ons": ["Nosepin/Nath", "Mangtika", "Brooch", "Buttons", "Kalingi", "Kanauti", "Mala"],
  "Exclusive - Grandeur": ["Choker", "Choker Set", "Necklace", "Necklace Set", "Long Necklace", "Long Necklace Set"],
};

export async function getReferenceImages(): Promise<ReferenceImage[]> {
  const response = await fetch('/api/reference-images');

  if (!response.ok) {
    throw new Error('Failed to fetch reference images');
  }

  return response.json();
}

export async function deleteReferenceImage(id: string): Promise<void> {
  const response = await fetch(`/api/reference-images/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete reference image');
  }
}

export async function generateDesign(request: DesignRequest, styleOverride?: File): Promise<DesignGenerationResponse> {
  const formData = new FormData();
  formData.append('category', request.category);
  formData.append('mode', request.mode ?? 'sketch');

  // String fields — only append if non-empty
  const stringFields: (keyof DesignRequest)[] = [
    'productSegment', 'priceBand', 'polkiSetting',
    'enamel', 'finish', 'designShape', 'styleInspiration', 'designType', 'earringStyle', 'materialRatio',
    'talaf', 'piroiPlacement', 'piroiColour', 'stoneShape', 'stoneSetting', 'diamondSetting', 'goldPurity', 'customNotes',
  ];
  for (const key of stringFields) {
    const val = request[key] as string | undefined;
    if (val && val !== '') {
      formData.append(key, val);
    }
  }

  // Array fields — only append if non-empty
  if (request.motifs && request.motifs.length > 0) {
    formData.append('motifs', JSON.stringify(request.motifs));
  }
  if (request.motifCategory && request.motifCategory.length > 0) {
    formData.append('motifCategory', JSON.stringify(request.motifCategory));
  }
  if (request.stoneName && request.stoneName.length > 0) {
    formData.append('stoneName', JSON.stringify(request.stoneName));
  }
  if (request.stoneNameColour && request.stoneNameColour.length > 0) {
    formData.append('stoneNameColour', JSON.stringify(request.stoneNameColour));
  }
  if (request.polkiSize && request.polkiSize.length > 0) {
    formData.append('polkiSize', JSON.stringify(request.polkiSize));
  }
  if (request.techniques && request.techniques.length > 0) {
    formData.append('techniques', JSON.stringify(request.techniques));
  }
  if (request.goldRatePerGram && request.goldRatePerGram > 0) {
    formData.append('goldRatePerGram', String(request.goldRatePerGram));
  }
  if (request.goldPercentage != null) {
    formData.append('goldPercentage', String(request.goldPercentage));
  }

  if (styleOverride) {
    formData.append('styleOverride', styleOverride);
  }

  const response = await fetch('/api/generate-design', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    const err = new Error(error.error || 'Failed to generate design');
    Sentry.captureException(err, { extra: { endpoint: '/api/generate-design', status: response.status } });
    throw err;
  }

  return response.json();
}

export async function getDesignProjects(): Promise<DesignProject[]> {
  const response = await fetch('/api/design-projects');

  if (!response.ok) {
    throw new Error('Failed to fetch design projects');
  }

  return response.json();
}

export async function getDesignProject(id: string): Promise<DesignProject> {
  const response = await fetch(`/api/design-projects/${id}`);

  if (!response.ok) {
    throw new Error('Failed to fetch design project');
  }

  return response.json();
}

export interface DriveImportResult {
  total: number;
  success: number;
  failed: number;
  results: { filename: string; success: boolean; error?: string }[];
}

export async function importFromDrive(folderUrl: string, themeCode?: string): Promise<DriveImportResult> {
  const response = await fetch('/api/import-from-drive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ folderUrl, themeCode }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import from Google Drive');
  }

  return response.json();
}

export interface DesignIteration {
  id: string;
  designProjectId: string;
  iterationNumber: number;
  editPrompt: string;
  sourceImageUrl: string;
  resultImageUrl: string;
}

export async function editDesign(designId: string, editPrompt: string): Promise<DesignIteration> {
  const response = await fetch(`/api/design-projects/${designId}/edit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ editPrompt }),
  });

  if (!response.ok) {
    const error = await response.json();
    const err = new Error(error.error || 'Failed to edit design');
    Sentry.captureException(err, { extra: { endpoint: `/api/design-projects/${designId}/edit`, status: response.status } });
    throw err;
  }

  return response.json();
}

export async function getDesignIterations(designId: string): Promise<DesignIteration[]> {
  const response = await fetch(`/api/design-projects/${designId}/iterations`);

  if (!response.ok) {
    throw new Error('Failed to fetch design iterations');
  }

  return response.json();
}

export interface SaveDesignResult {
  success: boolean;
  savedPath: string;
  folder: string;
  filename: string;
}

export async function saveDesign(designId: string, iterationIndex?: number): Promise<SaveDesignResult> {
  const response = await fetch(`/api/design-projects/${designId}/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ iterationIndex }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save design');
  }

  return response.json();
}

export interface ReembedResult {
  message: string;
  total: number;
  success: number;
  failed: number;
}

export async function reembedAllReferences(): Promise<ReembedResult> {
  const response = await fetch('/api/reembed-references', {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to re-embed references');
  }

  return response.json();
}

export interface ModifyDesignParams {
  productSegment?: string;
  category?: string;
  priceBand?: string;
  polkiSize?: string[];
  polkiSetting?: string;
  motifCategory?: string;
  motifs?: string[];
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
  stoneName?: string[];
  stoneNameColour?: string[];
  stoneShape?: string;
  stoneSetting?: string;
  diamondSetting?: string;
  customNotes?: string;
  goldRatePerGram?: number;
  goldPurity?: string;
  goldPercentage?: number;
}

export interface ModifyDesignResponse extends DesignGenerationResponse {
  costReport?: CostingReportData | null;
}

export interface CostingReportData {
  input: {
    totalBudget: number;
    goldPercentage: number;
    goldRatePerGram: number;
    goldPurity: string;
  };
  goldBudget: number;
  stoneBudget: number;
  gold: {
    purity: string;
    purityFraction: number;
    budgetAllocated: number;
    ratePerGram: number;
    effectiveRatePerGram: number;
    estimatedWeight: number;
    totalCost: number;
  };
  makingCharges: number;
  polki: { sieve: string; size_mm: string; count: number; weightPerPiece: number; totalWeight: number; ratePerGram: number; totalCost: number }[];
  diamond: { sieve: string; size_mm: string; count: number; weightPerPiece: number; totalCarats: number; ratePerCarat: number; totalCost: number }[];
  colorStones: { type: string; carats: number; ratePerCarat: number; totalCost: number }[];
  emeralds: { size_mm: string; count: number; weightPerPiece: number; totalCarats: number; ratePerCarat: number; totalCost: number }[];
  totalStoneCost: number;
  totalEstimatedCost: number;
  budgetVariance: number;
  generatedAt: string;
}

// Cascading dropdown data structure
export interface SegmentCategoryMap {
  [segment: string]: {
    category: string;
    price_bands: string[];
  }[];
}

export const SEGMENT_CATEGORY_PRICE_MAP: SegmentCategoryMap = {
  "Bridal": [
    { category: "Necklace", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Necklace Set", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Choker", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Choker Set", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Pendant (with piroi)", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Pendant Set (with piroi)", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Necklace (without piroi)", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Necklace Set (without piroi)", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
  ],
  "Bridal Lite": [
    { category: "Necklace", price_bands: ["15-25 Lakh"] },
    { category: "Necklace Set", price_bands: ["15-25 Lakh"] },
    { category: "Choker", price_bands: ["15-25 Lakh"] },
    { category: "Choker Set", price_bands: ["15-25 Lakh"] },
    { category: "Long Pendant (with piroi)", price_bands: ["15-25 Lakh"] },
    { category: "Long Pendant Set (with piroi)", price_bands: ["15-25 Lakh"] },
    { category: "Long Necklace (without piroi)", price_bands: ["15-25 Lakh"] },
    { category: "Long Necklace Set (without piroi)", price_bands: ["15-25 Lakh"] },
  ],
  "Traditional": [
    { category: "Necklace", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Necklace Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Choker", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Choker Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Long Pendant (with piroi)", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Long Pendant Set (with piroi)", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Long Necklace (without piroi)", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Long Necklace Set (without piroi)", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
  ],
  "Modern": [
    { category: "Necklace", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Necklace Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Choker", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Choker Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Necklace (without piroi)", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Necklace Set (without piroi)", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] },
  ],
  "Ready to Wear (RTW)": [
    { category: "Chain Necklace", price_bands: ["0-5 Lakh"] },
    { category: "Chain Necklace Set", price_bands: ["0-5 Lakh"] },
    { category: "Pendant", price_bands: ["0-5 Lakh"] },
    { category: "Pendant Set", price_bands: ["0-5 Lakh"] },
  ],
  "Ear Essentials": [
    { category: "Earring", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh"] },
  ],
  "Hand-wear": [
    { category: "Bracelet", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Bangle", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh"] },
    { category: "Hathphool", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Ring", price_bands: ["0-5 Lakh", "5-10 Lakh"] },
  ],
  "Add-ons": [
    { category: "Nosepin/Nath", price_bands: ["0-5 Lakh"] },
    { category: "Mangtika", price_bands: ["0-5 Lakh"] },
    { category: "Brooch", price_bands: ["0-5 Lakh", "5-10 Lakh"] },
    { category: "Mens Item – Buttons", price_bands: ["0-5 Lakh", "5-10 Lakh"] },
    { category: "Kalingi", price_bands: ["0-5 Lakh", "5-10 Lakh"] },
    { category: "Kanauti", price_bands: ["0-5 Lakh", "5-10 Lakh"] },
    { category: "Mala", price_bands: ["0-5 Lakh", "5-10 Lakh"] },
  ],
};

export interface DesignShapeEntry {
  shapes: string[];
  earringStyles?: string[];
}

export const DESIGN_SHAPE_MAP: Record<string, DesignShapeEntry> = {
  // Necklace family
  "Necklace": { shapes: ["Basic", "U-Shape", "Y-Shape", "V-Shape", "Layered", "Hasli"] },
  "Necklace Set": { shapes: ["Basic", "U-Shape", "Y-Shape", "V-Shape", "Layered", "Hasli"], earringStyles: ["Studs", "Drops", "Hoops"] },
  // Choker family
  "Choker": { shapes: ["Classic Choker", "Dog Band Choker", "Choker With Jhaalar", "Semi Chokar", "T-Shape"] },
  "Choker Set": { shapes: ["Classic Choker", "Dog Band Choker", "Choker With Jhaalar", "Semi Chokar", "T-Shape"], earringStyles: ["Studs", "Drops", "Hoops"] },
  // Long Pendant family
  "Long Pendant (with piroi)": { shapes: ["U-Shape", "Layered", "V-Shape", "Y-Shape"] },
  "Long Pendant Set (with piroi)": { shapes: ["U-Shape", "Layered", "V-Shape", "Y-Shape"], earringStyles: ["Studs", "Drops", "Hoops"] },
  // Long Necklace family
  "Long Necklace (without piroi)": { shapes: ["U-Shape", "Y-Shape", "V-Shape", "Layered"] },
  "Long Necklace Set (without piroi)": { shapes: ["U-Shape", "Y-Shape", "V-Shape", "Layered"], earringStyles: ["Studs", "Drops", "Hoops"] },
  // RTW
  "Chain Necklace": { shapes: ["Basic", "Layered"] },
  "Chain Necklace Set": { shapes: ["Basic", "Layered"], earringStyles: ["Studs", "Drops", "Hoops"] },
  "Pendant": { shapes: ["Basic", "Layered", "V-Shape", "Y-Shape"] },
  "Pendant Set": { shapes: ["Basic", "Layered", "V-Shape", "Y-Shape"], earringStyles: ["Studs", "Drops", "Hoops"] },
  // Ear Essentials
  "Earring": { shapes: ["Studs", "Drops", "Hoops"] },
  // Hand-wear
  "Bracelet": { shapes: ["Basic"] },
  "Bangle": { shapes: ["Round", "Oval"] },
  "Hathphool": { shapes: ["Basic"] },
  "Ring": { shapes: ["Basic"] },
  // Add-ons
  "Nosepin/Nath": { shapes: ["Basic"] },
  "Mangtika": { shapes: ["Basic"] },
  "Brooch": { shapes: ["Basic"] },
  "Mens Item \u2013 Buttons": { shapes: ["Basic"] },
  "Kalingi": { shapes: ["Basic"] },
  "Kanauti": { shapes: ["Single", "Layered"] },
  "Mala": { shapes: ["Basic"] },
};

// ─── Shared stone constants (used by Home, CAD Comparison, and Modify pages) ──

export const STONE_NAME_COLOUR_MAP: Record<string, string[]> = {
  "Aquamarine": ["Light Blue", "Light Green"],
  "Aventurian": ["Green"],
  "Sapphire": ["Yellow", "Blue"],
  "Emerald": ["Dark Green", "Green"],
  "Emerald Russian": ["Light Green"],
  "Emerald Colombian": ["Dark Green", "Green"],
  "Beryl": ["Green"],
  "Floride": ["Multi Color"],
  "Onyx": ["Green"],
  "Morganite": ["Pink", "Peach"],
  "Navratna": ["Multi Color"],
  "Opal": ["Multi Color"],
  "Ruby": ["Red"],
  "Tanzanite": ["Blue", "Violet"],
  "Tourmaline": ["Paraiba", "Pink", "Green", "Watermelon", "Yellow", "Orangish Brown", "Indigolite", "Blue", "Rubelite", "Brown", "Olive Green"],
  "Synthetic Stone": ["Multi Color"],
  "Pearl": ["White", "Cream"],
  "Basra Pearl": ["White", "Cream"],
  "JKC Pearl": ["White", "Cream"],
  "South Sea Pearl": ["White", "Golden"],
  "Coral": ["Red", "Orange"],
  "Green Strawberry": ["Green", "Pink"],
  "Hydro": ["Multi Color"],
  "Spinel": ["Multi Color"],
  "Ruby Glass Filled": ["Red"],
  "Amethyst": ["Purple"],
  "Turquoise": ["Blue", "Green"],
  "Nano Semi Precious": ["Multi Color"],
};

export const ALL_STONE_NAMES = Object.keys(STONE_NAME_COLOUR_MAP);

export const STONE_SHAPE_GROUPS: Record<string, string[]> = {
  "Faceted": [
    "Faceted Round", "Faceted Oval", "Faceted Pear", "Faceted Square",
    "Faceted Cushion", "Faceted Elongated Cushion", "Emerald Cut",
    "Faceted Marquise", "Faceted Heart", "Faceted Hexagon",
    "Faceted Lozenge", "Faceted Pentagon", "Faceted Kite", "Faceted Trillion",
  ],
  "Rose Cut": [
    "Rose Cut Round", "Rose Cut Oval", "Rose Cut Pear",
  ],
  "Cabochon": [
    "Cabochon Round", "Cabochon Oval", "Cabochon Pear", "Cabochon Square",
    "Cabochon Cushion", "Cabochon Elongated Cushion", "Emerald Cut",
    "Cabochon Marquise", "Cabochon Heart", "Cabochon Trillion",
  ],
  "Carved / Special": [
    "Carved Round", "Carved Oval", "Carved Pear", "Carved Square",
    "Carved Cushion", "Barrel", "Cylindrical", "Snowflake", "Flower", "Clover Leaf",
  ],
};

export const STONE_SHAPES = Object.values(STONE_SHAPE_GROUPS).flat();

/** Create a unique Select value for stone shapes (handles duplicates like "Emerald Cut" across groups) */
export function stoneShapeSelectValue(group: string, shape: string): string {
  return `${group}::${shape}`;
}

/** Extract the display/API shape name from a group-prefixed Select value */
export function parseStoneShapeValue(value: string): string {
  const idx = value.indexOf("::");
  return idx >= 0 ? value.slice(idx + 2) : value;
}

export const GOLD_PURITIES = ["9k", "14k", "18k", "22k"] as const;

// ─────────────────────────────────────────────────────────────────────────────

export interface CADComparisonResult {
  gemini: ModelResult;
  openai: ModelResult;
  grok: ModelResult;
  prompt: string;
  costReport?: CostingReportData | null;
}

export interface CADComparisonParams {
  productSegment?: string;
  category?: string;
  priceBand?: string;
  polkiSize?: string[];
  polkiSetting?: string;
  motifCategory?: string[];
  motifs?: string[];
  stoneName?: string[];
  stoneNameColour?: string[];
  stoneShape?: string;
  stoneSetting?: string;
  diamondSetting?: string;
  materialRatio?: string;
  enamel?: string;
  finish?: string;
  designShape?: string;
  styleInspiration?: string;
  designType?: string;
  techniques?: string[];
  earringStyle?: string;
  talaf?: string;
  piroiPlacement?: string;
  piroiColour?: string;
  goldRatePerGram?: number;
  goldPurity?: string;
  goldPercentage?: number;
  customNotes?: string;
}

export async function generateCADComparison(
  params: CADComparisonParams
): Promise<CADComparisonResult> {
  const response = await fetch("/api/generate-cad-comparison", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    let errorMessage = "Failed to generate CAD comparison";
    try {
      const err = await response.json();
      errorMessage = err.error || err.message || errorMessage;
    } catch {
      errorMessage = `Server returned ${response.status} ${response.statusText}`;
    }
    const error = new Error(errorMessage);
    Sentry.captureException(error, { extra: { endpoint: '/api/generate-cad-comparison', status: response.status } });
    throw error;
  }
  return response.json();
}

export const MARKETING_FORM_OPTIONS = {
  modelEthnicity: [
    "Indian / South Asian",
    "East Asian",
    "Middle Eastern",
    "Western / European",
    "African",
    "Mixed / AI decides"
  ],
  modelStyle: [
    "Indian Bridal — heavy lehenga, full jewellery styling, ornate backdrop",
    "Indian Traditional — saree, classic studio setting",
    "Modern Editorial — minimal outfit, clean high-fashion aesthetic",
    "Fusion Contemporary — modern Indian wear, lifestyle setting"
  ],
  backgroundSetting: [
    "Luxury studio — white/ivory seamless backdrop",
    "Royal palace interior — arches, marble, warm light",
    "Garden / floral — lush greenery, soft natural light",
    "Rooftop at golden hour — warm ambient light, city backdrop",
    "Dark dramatic — deep jewel-toned background, moody lighting",
    "Minimalist — clean gradient, product-focused"
  ],
  lightingMood: [
    "Soft diffused — flattering, even, editorial",
    "Golden hour — warm, glowing, festive",
    "High contrast — dramatic shadows, luxury feel",
    "Natural daylight — fresh, clean, modern",
    "Studio strobe — sharp, commercial, high clarity"
  ],
  outfitStyle: [
    "Heavy bridal lehenga — red / maroon",
    "Heavy bridal lehenga — ivory / gold",
    "Silk saree — traditional drape",
    "Contemporary lehenga — pastel",
    "Anarkali / churidar — formal",
    "Minimal — bare shoulder / blouse focus (jewellery focal)",
    "Western formal — black gown"
  ],
  composition: [
    "Close-up portrait — face and neckline, jewellery focal",
    "Half body — waist up, full necklace and earrings visible",
    "Three-quarter — knees up, shows full look",
    "Full length — head to toe editorial",
    "Detail close-up — extreme close on the jewellery piece"
  ],
  jewelleryCategory: [
    "Necklace / Necklace Set",
    "Choker / Choker Set",
    "Long Necklace",
    "Earrings",
    "Bangles",
    "Bracelet",
    "Ring",
    "Maangtika",
    "Nath / Nosepin",
    "Hathphool",
    "Full Bridal Set"
  ]
} as const;

export interface MarketingVisualParams {
  jewelleryCategory: string;
  modelEthnicity: string;
  modelStyle: string;
  backgroundSetting: string;
  lightingMood: string;
  outfitStyle: string;
  composition: string;
  customNotes?: string;
}

export interface MarketingVisualResult {
  imageUrl: string | null;
  error: string | null;
  model: string;
}

export interface MarketingVisualResponse {
  projectId: string | null;
  prompt: string;
  gemini: MarketingVisualResult;
  openai: MarketingVisualResult;
  grok: MarketingVisualResult;
}

export async function generateMarketingVisual(
  imageFile: File,
  params: MarketingVisualParams
): Promise<MarketingVisualResponse> {
  const formData = new FormData();
  formData.append("image", imageFile);
  formData.append("jewelleryCategory", params.jewelleryCategory);
  formData.append("modelEthnicity", params.modelEthnicity);
  formData.append("modelStyle", params.modelStyle);
  formData.append("backgroundSetting", params.backgroundSetting);
  formData.append("lightingMood", params.lightingMood);
  formData.append("outfitStyle", params.outfitStyle);
  formData.append("composition", params.composition);
  if (params.customNotes) {
    formData.append("customNotes", params.customNotes);
  }

  const response = await fetch("/api/generate-marketing", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorMessage = "Failed to generate marketing visual";
    try {
      const err = await response.json();
      errorMessage = err.error || err.message || errorMessage;
    } catch {
      errorMessage = `Server returned ${response.status} ${response.statusText}`;
    }
    const error = new Error(errorMessage);
    Sentry.captureException(error, { extra: { endpoint: '/api/generate-marketing', status: response.status } });
    throw error;
  }

  return response.json();
}

export interface DesignImageImportStatus {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export async function startDesignImageImport(): Promise<{
  status: string;
  total: number;
  alreadyImported: number;
}> {
  const res = await fetch('/api/import-design-images', { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getDesignImageImportStatus(): Promise<DesignImageImportStatus> {
  const res = await fetch('/api/import-design-images/status');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function backfillPieceTypes(): Promise<{ updated: number; skipped: number; total: number }> {
  const res = await fetch('/api/backfill-piece-types', { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function modifyDesign(
  imageFile: File,
  params: ModifyDesignParams
): Promise<ModifyDesignResponse> {
  const formData = new FormData();
  formData.append('image', imageFile);

  const stringFields: (keyof ModifyDesignParams)[] = [
    'productSegment', 'category', 'priceBand', 'polkiSetting', 'motifCategory',
    'enamel', 'finish', 'designShape', 'styleInspiration', 'designType', 'earringStyle', 'materialRatio',
    'talaf', 'piroiPlacement', 'piroiColour', 'stoneShape', 'stoneSetting', 'diamondSetting', 'customNotes',
  ];

  for (const key of stringFields) {
    const val = params[key] as string | undefined;
    if (val && val !== '') {
      formData.append(key, val);
    }
  }

  if (params.motifs && params.motifs.length > 0) {
    formData.append('motifs', JSON.stringify(params.motifs));
  }
  if (params.stoneName && params.stoneName.length > 0) {
    formData.append('stoneName', JSON.stringify(params.stoneName));
  }
  if (params.stoneNameColour && params.stoneNameColour.length > 0) {
    formData.append('stoneNameColour', JSON.stringify(params.stoneNameColour));
  }
  if (params.polkiSize && params.polkiSize.length > 0) {
    formData.append('polkiSize', JSON.stringify(params.polkiSize));
  }
  if (params.techniques && params.techniques.length > 0) {
    formData.append('techniques', JSON.stringify(params.techniques));
  }
  if (params.goldRatePerGram && params.goldRatePerGram > 0) {
    formData.append('goldRatePerGram', String(params.goldRatePerGram));
  }
  if (params.goldPurity) {
    formData.append('goldPurity', params.goldPurity);
  }
  if (params.goldPercentage != null) {
    formData.append('goldPercentage', String(params.goldPercentage));
  }

  const response = await fetch('/api/modify-design', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    const err = new Error(error.error || 'Failed to modify design');
    Sentry.captureException(err, { extra: { endpoint: '/api/modify-design', status: response.status } });
    throw err;
  }

  return response.json();
}

// ── Assortment Planning API ────────────────────────────────────────────────

export interface StockItemSummary {
  id: string;
  jewelCode: string;
  styleNo: string;
  imageUrl: string | null;
  category: string | null;
  tagPrice: number | null;
  status: string;
  grossWt: string | null;
  pureWt: string | null;
  collectionName: string | null;
  subCategory: string | null;
  priceMatch: number;
  stockType?: string | null;
  ageingDays?: number | null;
  score?: number;
}

export interface AssortmentRecommendation {
  category: string;
  salesCount: number;
  avgPrice: number;
  suggested: StockItemSummary | null;
  alternatives: StockItemSummary[];
  matchedEarring?: StockItemSummary | null;
}

export interface BdmProfile {
  bdmName: string;
  totalSales: number;
  totalRevenue: number;
  topCategories: { category: string; count: number; revenue: number }[];
  avgStockAge?: number;
  stockTypeBreakdown?: { stockType: string; percentage: number }[];
}

export interface StateSummary {
  stateName: string;
  totalSales: number;
  totalRevenue: number;
  topCategories: { category: string; count: number; revenue: number; avgPrice: number }[];
}

export interface AssortmentRecommendationResponse {
  bdmName: string;
  recommendations: AssortmentRecommendation[];
  profile: BdmProfile;
}

export interface EmbedStockStatus {
  running: boolean;
  total: number;
  processed: number;
  failed: number;
}

export async function getAssortmentBdmList(): Promise<{ bdmNames: string[] }> {
  const res = await fetch("/api/assortment/bdm-list");
  if (!res.ok) throw new Error("Failed to fetch BDM list");
  return res.json();
}

export async function getAssortmentBdmProfile(bdmName: string): Promise<{
  bdmName: string;
  totalSales: number;
  totalRevenue: number;
  topCategories: { category: string; count: number; revenue: number }[];
  topStyleCodes: { styleCode: string; count: number }[];
  stateBreakdown: { state: string; count: number }[];
}> {
  const res = await fetch(`/api/assortment/bdm-profile/${encodeURIComponent(bdmName)}`);
  if (!res.ok) throw new Error("Failed to fetch BDM profile");
  return res.json();
}

export async function generateAssortmentRecommendations(
  bdmName: string,
  topK?: number,
  stateName?: string
): Promise<AssortmentRecommendationResponse> {
  const res = await fetch("/api/assortment/generate-recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bdmName, topK, stateName }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to generate recommendations");
  }
  return res.json();
}

export async function getAssortmentStateList(): Promise<{ states: string[] }> {
  const res = await fetch("/api/assortment/state-list");
  if (!res.ok) throw new Error("Failed to fetch state list");
  return res.json();
}

export async function getAssortmentStateSummary(stateName: string): Promise<StateSummary> {
  const res = await fetch(`/api/assortment/state-summary/${encodeURIComponent(stateName)}`);
  if (!res.ok) throw new Error("Failed to fetch state summary");
  return res.json();
}

export async function importAssortmentSales(): Promise<{ imported: number; sheet: string }> {
  const res = await fetch("/api/assortment/import-sales", { method: "POST" });
  if (!res.ok) throw new Error("Failed to import sales data");
  return res.json();
}

export async function importAssortmentStock(): Promise<{ imported: number; sheet: string }> {
  const res = await fetch("/api/assortment/import-stock", { method: "POST" });
  if (!res.ok) throw new Error("Failed to import stock data");
  return res.json();
}

export async function getAssortmentImportStatus(): Promise<{
  salesCount: number;
  stockCount: number;
  embeddedCount: number;
}> {
  const res = await fetch("/api/assortment/import-status");
  if (!res.ok) throw new Error("Failed to fetch import status");
  return res.json();
}

export async function startStockEmbedding(): Promise<{ status: string; total: number }> {
  const res = await fetch("/api/assortment/embed-stock", { method: "POST" });
  if (!res.ok) throw new Error("Failed to start embedding");
  return res.json();
}

export async function getStockEmbeddingStatus(): Promise<EmbedStockStatus> {
  const res = await fetch("/api/assortment/embed-stock/status");
  if (!res.ok) throw new Error("Failed to fetch embedding status");
  return res.json();
}

export async function saveAssortmentPlan(
  bdmName: string,
  selectedItemIds: string[],
  notes?: string
): Promise<{ id: string }> {
  const res = await fetch("/api/assortment/save-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bdmName, selectedItemIds, notes }),
  });
  if (!res.ok) throw new Error("Failed to save plan");
  return res.json();
}

// -- Feedback API -----------------------------------------------------------

export interface DesignFeedbackEntry {
  id: string;
  designProjectId: string | null;
  feedbackText: string;
  category: string;
  theme: string;
  tags: string[];
  sentiment: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackListResponse {
  data: DesignFeedbackEntry[];
  total: number;
  page: number;
  limit: number;
}

export async function createFeedback(data: {
  feedbackText: string;
  category: string;
  theme: string;
  tags?: string[];
  sentiment?: "positive" | "corrective";
  designProjectId?: string;
}): Promise<DesignFeedbackEntry> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create feedback");
  }
  return response.json();
}

export async function getFeedbackList(params?: {
  page?: number;
  limit?: number;
  category?: string;
  theme?: string;
}): Promise<FeedbackListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.category) searchParams.set("category", params.category);
  if (params?.theme) searchParams.set("theme", params.theme);

  const qs = searchParams.toString();
  const url = qs ? `/api/feedback?${qs}` : "/api/feedback";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch feedback list");
  }
  return response.json();
}

export async function getFeedbackById(id: string): Promise<DesignFeedbackEntry> {
  const response = await fetch(`/api/feedback/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Feedback not found");
    }
    throw new Error("Failed to fetch feedback");
  }
  return response.json();
}

export async function updateFeedback(
  id: string,
  data: {
    feedbackText?: string;
    tags?: string[];
    sentiment?: "positive" | "corrective";
  }
): Promise<DesignFeedbackEntry> {
  const response = await fetch(`/api/feedback/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update feedback");
  }
  return response.json();
}

export async function deleteFeedback(id: string): Promise<{ success: boolean }> {
  const response = await fetch(`/api/feedback/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Feedback not found");
    }
    throw new Error("Failed to delete feedback");
  }
  return response.json();
}
