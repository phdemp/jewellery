/**
 * Vector-Based Assortment Scoring Engine
 *
 * Uses pre-computed pgvector embeddings (3072-dim) to:
 * 1. Average a BDM's past sales embeddings into a "profile vector"
 * 2. Cosine-similarity search against live stock embeddings
 * 3. One lightweight text-only Gemini call for profile summary
 * 4. Formula boosts for ageing, margin, location
 *
 * No image downloads at request time. No Vision API calls.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import type { B2bSalesHistory } from "@shared/schema";

// ── Gemini client (lazy init) ─────────────────────────────────────────────

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return _ai;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClientPreferences {
  clientName: string;
  totalTransactions: number;
  primarySegments: string[];
  segmentDistribution: Record<string, number>;
  preferredCategories: string[];
  priceRange: { min: number; max: number; median: number };
  weightRange: { min: number; max: number; median: number };
  stoneProfile: {
    avgPolkiRatio: number;
    avgDiamondRatio: number;
    avgColorStoneRatio: number;
    preferredColours: string[];
    materialRatioPreference: string;
  };
}

export interface BdmStyleProfile {
  preferredSegments: string[];
  preferredCategories: string[];
  priceRange: { min: number; max: number; sweet_spot: number };
  visualPatterns: string[];
  preferredMotifs: string[];
  preferredFinishes: string[];
  stockTypePreference: Record<string, number>;
  summary: string;
  clientPreferences?: ClientPreferences;
}

export interface ScoreBreakdown {
  segment: number;   // 0-1 normalized
  category: number;  // 0-1 normalized
  visual: number;    // 0-1 normalized (composite of stones + motifs)
  price: number;     // 0-1 normalized
  bonus: number;     // Additive (location boost)
}

export interface ScoredItemReason {
  tag: string;
  text: string;
}

export interface AiScoredItem {
  jewelCode: string;
  total: number;
  breakdown: ScoreBreakdown;
  reasons: ScoredItemReason[];
}

export interface InventoryCandidate {
  jewelCode: string;
  styleNo: string;
  category: string;
  tagPrice: number;
  costPrice: number;
  ageingDays: number;
  grossWt: string;
  pureWt: string;
  totDiaWt: string;
  stockType: string;
  location: string;
  imageUrl: string;
  baseMetal: string;
  currentStatus: string;
  productSegment: string;
  totPolkiWt: string;
  totColorStoneWt: string;
  motif: string;
  motifCategory: string;
}

export interface AiScoreResult {
  items: Array<AiScoredItem & { inventoryData: InventoryCandidate }>;
  profile: BdmStyleProfile & {
    bdmName: string;
    totalSalesAnalyzed: number;
    embeddedSalesUsed: number;
  };
  timing: {
    profileMs: number;
    scoringMs: number;
    totalMs: number;
    method: "vector" | "formula";
  };
}

// ── Profile cache (30-min TTL) ─────────────────────────────────────────────

interface CachedProfile {
  profile: BdmStyleProfile;
  profileVector: number[] | null;
  embeddedSalesUsed: number;
  createdAt: number;
}

const profileCache = new Map<string, CachedProfile>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(bdmName: string, stateName?: string, clientName?: string): string {
  return [bdmName, stateName || "", clientName || ""].join("|");
}

// ── Step 1: Build BDM profile vector from embedded sales ──────────────────

interface SalesEmbeddingRow {
  embedding_vector: string;
  category: string | null;
  category_group: string | null;
  tag_price: number | null;
  final_price: number | null;
  stock_type: string | null;
  make_type: string | null;
  motif: string | null;
  finish: string | null;
  product_segment: string | null;
}

async function fetchBdmSalesEmbeddings(
  bdmName: string,
  stateName?: string,
  clientName?: string
): Promise<{ embeddings: number[][]; rows: SalesEmbeddingRow[] }> {
  let whereClause = `sales_person_name = '${bdmName.replace(/'/g, "''")}'
    AND embedding_vector IS NOT NULL
    AND embedding_status = 'done'`;

  if (stateName) {
    whereClause += ` AND state_name = '${stateName.replace(/'/g, "''")}'`;
  }
  if (clientName) {
    whereClause += ` AND client_name = '${clientName.replace(/'/g, "''")}'`;
  }

  const result = await db.execute(sql.raw(`
    SELECT embedding_vector::text, category, category_group, tag_price, final_price,
           stock_type, make_type, motif, finish, product_segment
    FROM b2b_sales_history
    WHERE ${whereClause}
    ORDER BY final_price DESC NULLS LAST
    LIMIT 100
  `));

  const embeddings: number[][] = [];
  const rows = result.rows as Record<string, unknown>[];

  for (const row of rows) {
    try {
      const vecStr = String(row.embedding_vector || "");
      const nums = vecStr.replace(/^\[/, "").replace(/\]$/, "").split(",").map(Number);
      if (nums.length === 3072 && nums.every(n => !isNaN(n))) {
        embeddings.push(nums);
      }
    } catch {
      // skip malformed embeddings
    }
  }

  return { embeddings, rows: rows as unknown as SalesEmbeddingRow[] };
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    avg[i] /= vectors.length;
  }
  // L2-normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) avg[i] /= norm;
  }
  return avg;
}

// ── Step 2: Vector similarity search against live stock ───────────────────

interface VectorScoredRow {
  jewel_code: string;
  style_no: string;
  category: string;
  tag_price: number;
  cost_price: number;
  ageing_days: number;
  gross_wt: string;
  pure_wt: string;
  tot_dia_wt: string;
  stock_type: string;
  location: string;
  image_url: string;
  base_metal: string;
  current_status: string;
  similarity: number;
  product_segment: string;
  tot_polki_wt: string;
  tot_color_stone_wt: string;
  motif: string;
  motif_category: string;
}

async function searchSimilarStock(
  profileVector: number[],
  limit: number,
  weightMin?: number,
  weightMax?: number,
  segmentFilter?: string[]
): Promise<VectorScoredRow[]> {
  const vectorStr = `[${profileVector.join(",")}]`;

  let whereClause = `ls.current_status = 'On Hand'
    AND ls.embedding_vector IS NOT NULL
    AND ls.embedding_status = 'done'`;

  if (weightMin) {
    whereClause += ` AND CAST(NULLIF(TRIM(ls.gross_wt), '') AS NUMERIC) >= ${Number(weightMin)}`;
  }
  if (weightMax) {
    whereClause += ` AND CAST(NULLIF(TRIM(ls.gross_wt), '') AS NUMERIC) <= ${Number(weightMax)}`;
  }
  if (segmentFilter && segmentFilter.length > 0) {
    const escaped = segmentFilter.map(s => `'${s.replace(/'/g, "''")}'`).join(",");
    whereClause += ` AND ls.product_segment IN (${escaped})`;
  }

  const result = await db.execute(sql.raw(`
    SELECT
      ls.jewel_code, ls.style_no, ls.category, ls.tag_price, ls.cost_price,
      ls.ageing_days, ls.gross_wt, ls.pure_wt, ls.tot_dia_wt, ls.stock_type,
      ls.location, ls.image_url, ls.base_metal, ls.current_status,
      ls.product_segment, ls.tot_polki_wt, ls.tot_color_stone_wt,
      COALESCE(si.motif, '') as motif,
      COALESCE(si.motif_category, '') as motif_category,
      1 - (ls.embedding_vector::vector(3072) <=> '${vectorStr}'::vector(3072)) as similarity
    FROM live_stock_items ls
    LEFT JOIN stock_items si ON si.jewel_code = ls.jewel_code
    WHERE ${whereClause}
    ORDER BY ls.embedding_vector::vector(3072) <=> '${vectorStr}'::vector(3072)
    LIMIT ${limit}
  `));

  return (result.rows as Record<string, unknown>[]).map(row => ({
    jewel_code: String(row.jewel_code || ""),
    style_no: String(row.style_no || ""),
    category: String(row.category || ""),
    tag_price: Number(row.tag_price) || 0,
    cost_price: Number(row.cost_price) || 0,
    ageing_days: Number(row.ageing_days) || 0,
    gross_wt: String(row.gross_wt || "0"),
    pure_wt: String(row.pure_wt || "0"),
    tot_dia_wt: String(row.tot_dia_wt || "0"),
    stock_type: String(row.stock_type || ""),
    location: String(row.location || ""),
    image_url: String(row.image_url || ""),
    base_metal: String(row.base_metal || ""),
    current_status: String(row.current_status || ""),
    similarity: parseFloat(String(row.similarity)) || 0,
    product_segment: String(row.product_segment || ""),
    tot_polki_wt: String(row.tot_polki_wt || "0"),
    tot_color_stone_wt: String(row.tot_color_stone_wt || "0"),
    motif: String(row.motif || ""),
    motif_category: String(row.motif_category || ""),
  }));
}

// ── Step 2b: Fetch raw stock candidates (no embeddings required) ────────────
// Used as fallback when vector search returns 0 results because stock items
// lack embeddings even though BDM sales have them.

async function fetchRawStockCandidates(
  limit: number,
  weightMin?: number,
  weightMax?: number,
  segmentFilter?: string[]
): Promise<InventoryCandidate[]> {
  let whereClause = `ls.current_status = 'On Hand'`;

  if (weightMin) {
    whereClause += ` AND CAST(NULLIF(TRIM(ls.gross_wt), '') AS NUMERIC) >= ${Number(weightMin)}`;
  }
  if (weightMax) {
    whereClause += ` AND CAST(NULLIF(TRIM(ls.gross_wt), '') AS NUMERIC) <= ${Number(weightMax)}`;
  }
  if (segmentFilter && segmentFilter.length > 0) {
    const escaped = segmentFilter.map(s => `'${s.replace(/'/g, "''")}'`).join(",");
    whereClause += ` AND ls.product_segment IN (${escaped})`;
  }

  const result = await db.execute(sql.raw(`
    SELECT ls.jewel_code, ls.style_no, ls.category, ls.tag_price, ls.cost_price,
           ls.ageing_days, ls.gross_wt, ls.pure_wt, ls.tot_dia_wt, ls.stock_type,
           ls.location, ls.image_url, ls.base_metal, ls.current_status,
           ls.product_segment, ls.tot_polki_wt, ls.tot_color_stone_wt,
           COALESCE(si.motif, '') as motif,
           COALESCE(si.motif_category, '') as motif_category
    FROM live_stock_items ls
    LEFT JOIN stock_items si ON si.jewel_code = ls.jewel_code
    WHERE ${whereClause}
    ORDER BY ls.tag_price DESC
    LIMIT ${limit}
  `));

  return (result.rows as Record<string, unknown>[]).map(row => ({
    jewelCode: String(row.jewel_code || ""),
    styleNo: String(row.style_no || ""),
    category: String(row.category || ""),
    tagPrice: Number(row.tag_price) || 0,
    costPrice: Number(row.cost_price) || 0,
    ageingDays: Number(row.ageing_days) || 0,
    grossWt: String(row.gross_wt || "0"),
    pureWt: String(row.pure_wt || "0"),
    totDiaWt: String(row.tot_dia_wt || "0"),
    stockType: String(row.stock_type || ""),
    location: String(row.location || ""),
    imageUrl: String(row.image_url || ""),
    baseMetal: String(row.base_metal || ""),
    currentStatus: String(row.current_status || ""),
    productSegment: String(row.product_segment || ""),
    totPolkiWt: String(row.tot_polki_wt || "0"),
    totColorStoneWt: String(row.tot_color_stone_wt || "0"),
    motif: String(row.motif || ""),
    motifCategory: String(row.motif_category || ""),
  }));
}


// ── Step 3: Text-only BDM profile (one Gemini call) ───────────────────────

async function generateProfileSummary(
  sales: B2bSalesHistory[],
  bdmName: string
): Promise<BdmStyleProfile> {
  const itemsMetadata = sales.slice(0, 40).map((s, i) => {
    return [
      `${i + 1}. JC ${s.jewelCode}`,
      s.category,
      s.categoryGroup,
      s.tagPrice ? `₹${s.tagPrice.toLocaleString()}` : null,
      s.finalPrice ? `Sold ₹${s.finalPrice.toLocaleString()}` : null,
      s.stockType,
      s.makeType,
      s.baseMetalQuality,
      s.motif,
      s.finish,
      s.productSegment,
      s.designShape,
    ].filter(Boolean).join(", ");
  }).join("\n");

  const prompt = `You are an expert jewellery merchandising analyst for Raniwala 1881.
Analyze these ${sales.length} sold items by BDM "${bdmName}" and build a style preference profile.

ITEMS SOLD (top ${Math.min(40, sales.length)}):
${itemsMetadata}

Respond with ONLY valid JSON:
{
  "preferredSegments": ["top 3 product segments"],
  "preferredCategories": ["top 3-5 categories"],
  "priceRange": { "min": <number>, "max": <number>, "sweet_spot": <number> },
  "visualPatterns": ["2-3 style patterns inferred from metadata"],
  "preferredMotifs": ["motifs seen"],
  "preferredFinishes": ["finish types"],
  "stockTypePreference": { "BRIDAL": 0.4, "WEARABLE": 0.3, "COLLECTABLE": 0.2, "SOLITAIRE": 0.1 },
  "summary": "2-3 sentence summary of selling style"
}`;

  const response = await getAI().models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      httpOptions: { timeout: 20_000 },
    },
  });

  const text = response.text?.trim() || "";
  const jsonStr = text.replace(/^```json?\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(jsonStr);

  return {
    preferredSegments: parsed.preferredSegments || [],
    preferredCategories: parsed.preferredCategories || [],
    priceRange: parsed.priceRange || { min: 0, max: 0, sweet_spot: 0 },
    visualPatterns: parsed.visualPatterns || [],
    preferredMotifs: parsed.preferredMotifs || [],
    preferredFinishes: parsed.preferredFinishes || [],
    stockTypePreference: parsed.stockTypePreference || {},
    summary: parsed.summary || "",
  };
}

function buildFallbackProfile(bdmName: string): BdmStyleProfile {
  return {
    preferredSegments: [],
    preferredCategories: ["Necklace Set", "Choker", "Bangle"],
    priceRange: { min: 100000, max: 500000, sweet_spot: 250000 },
    visualPatterns: ["General luxury jewellery"],
    preferredMotifs: [],
    preferredFinishes: ["Yellow Gold Finish"],
    stockTypePreference: { BRIDAL: 0.3, WEARABLE: 0.3, COLLECTABLE: 0.2, SOLITAIRE: 0.2 },
    summary: `No past sales data for ${bdmName}. Using generic profile.`,
  };
}

// ── Scoring helpers ─────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

// Raniwala own stores get highest priority, Delhi gets moderate
const RANIWALA_OWN_LOCATIONS = ["RANIWALA", "JAIPUR STORE"];
const RANIWALA_OTHER_LOCATIONS = ["DELHI STORE"];

function locationBoost(location: string | undefined): { boost: number; reason: string | null } {
  const loc = (location || "").toUpperCase();
  if (RANIWALA_OWN_LOCATIONS.some(r => loc.includes(r))) {
    return { boost: 8, reason: "Raniwala store — readily available" };
  }
  if (RANIWALA_OTHER_LOCATIONS.some(r => loc.includes(r))) {
    return { boost: 3, reason: null };
  }
  return { boost: 0, reason: null };
}

/** BDM-configurable scoring weights (must sum to 100). */
export interface ScoringWeights {
  segment: number;
  category: number;
  visual: number;
  price: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = { segment: 30, category: 25, visual: 25, price: 20 };

/** Similarity range from the result set — used to normalize visual scores. */
interface SimRange {
  min: number;
  max: number;
}

/** Cosine similarity between two 3D vectors (stone composition). */
function stoneCosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < 3; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0.3; // no data fallback
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function scoreCandidate(
  row: VectorScoredRow,
  profile: BdmStyleProfile,
  _simRange: SimRange,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): AiScoredItem & { inventoryData: InventoryCandidate } {
  const reasons: ScoredItemReason[] = [];
  const clientPrefs = profile.clientPreferences;

  // ── 1. SEGMENT (0-1): match product segment against preferences ──
  const prefSegs = clientPrefs?.primarySegments || profile.preferredSegments || [];
  const seg = row.product_segment || "";
  let segNorm = 0.2;
  if (seg && prefSegs.some(ps => seg.toLowerCase().includes(ps.toLowerCase()))) {
    segNorm = 1.0;
    reasons.push({ tag: "match", text: `${seg} matches preferred segment` });
  } else if (seg) {
    segNorm = 0.3;
  }

  // ── 2. CATEGORY (0-1): match against client or BDM preferred categories ──
  const prefCats = clientPrefs?.preferredCategories || profile.preferredCategories;
  const cat = row.category?.toLowerCase() || "";
  let catNorm = 0.3;
  if (prefCats.some(pc => cat.includes(pc.toLowerCase()))) {
    catNorm = 0.8;
    reasons.push({ tag: "category", text: `${row.category} matches preferred categories` });
  }

  // ── 3. VISUAL (0-1): composite of stones (50%) + motifs (50%) ──
  // 3a. Stones sub-score
  let stoneScore = 0.4;
  const grossWtNum = parseFloat(row.gross_wt) || 1;
  const polkiWt = (parseFloat(row.tot_polki_wt) || 0) / grossWtNum;
  const diaWt = (parseFloat(row.tot_dia_wt) || 0) / grossWtNum;
  const csWt = (parseFloat(row.tot_color_stone_wt) || 0) / grossWtNum;
  if (clientPrefs && clientPrefs.stoneProfile) {
    const sp = clientPrefs.stoneProfile;
    const stockVec = [polkiWt, diaWt, csWt];
    const clientVec = [sp.avgPolkiRatio, sp.avgDiamondRatio, sp.avgColorStoneRatio];
    stoneScore = stoneCosineSim(stockVec, clientVec);
    if (stoneScore >= 0.8) reasons.push({ tag: "pref", text: `Stone composition matches client preference` });
  }
  // 3b. Motif sub-score
  let motifScore = 0.4;
  const prefMotifs = profile.preferredMotifs || [];
  if (row.motif && prefMotifs.length > 0) {
    if (prefMotifs.some(m => row.motif.toLowerCase().includes(m.toLowerCase()))) {
      motifScore = 1.0;
      reasons.push({ tag: "pref", text: `Motif "${row.motif}" matches preference` });
    } else if (row.motif_category && prefMotifs.some(m => row.motif_category.toLowerCase().includes(m.toLowerCase()))) {
      motifScore = 0.6;
    } else {
      motifScore = 0.2;
    }
  }
  const vNorm = 0.5 * stoneScore + 0.5 * motifScore;

  // ── 4. PRICE (0-1): proximity to client/BDM price range ──
  let priNorm = 0.3;
  const price = row.tag_price;
  if (clientPrefs && clientPrefs.priceRange.median > 0 && price > 0) {
    const median = clientPrefs.priceRange.median;
    const deviation = Math.abs(price - median) / median;
    if (deviation <= 0.15) { priNorm = 1.0; reasons.push({ tag: "band", text: `₹${price.toLocaleString()} near client median ₹${median.toLocaleString()}` }); }
    else if (deviation <= 0.30) { priNorm = 0.7; }
    else if (price >= clientPrefs.priceRange.min && price <= clientPrefs.priceRange.max) { priNorm = 0.4; }
    else { priNorm = 0.1; }
  } else {
    const { min: pMin, max: pMax, sweet_spot } = profile.priceRange;
    if (sweet_spot > 0 && price > 0) {
      const deviation = Math.abs(price - sweet_spot) / sweet_spot;
      if (deviation <= 0.15) { priNorm = 1.0; reasons.push({ tag: "band", text: `₹${price.toLocaleString()} near sweet spot ₹${sweet_spot.toLocaleString()}` }); }
      else if (deviation <= 0.30) { priNorm = 0.7; }
      else if (price >= pMin && price <= pMax) { priNorm = 0.4; }
      else { priNorm = 0.1; }
    }
  }

  // ── Weighted total ──
  let total = Math.round(
    segNorm * weights.segment +
    catNorm * weights.category +
    vNorm * weights.visual +
    priNorm * weights.price
  );

  let bonus = 0;
  const locBoost = locationBoost(row.location);
  if (locBoost.boost > 0) {
    const lb = Math.min(locBoost.boost, 3); total += lb; bonus += lb;
    if (locBoost.reason) reasons.push({ tag: "pref", text: locBoost.reason });
  }

  total = clamp(total, 0, 100);

  const candidate: InventoryCandidate = {
    jewelCode: row.jewel_code,
    styleNo: row.style_no,
    category: row.category,
    tagPrice: row.tag_price,
    costPrice: row.cost_price,
    ageingDays: row.ageing_days,
    grossWt: row.gross_wt,
    pureWt: row.pure_wt,
    totDiaWt: row.tot_dia_wt,
    stockType: row.stock_type,
    location: row.location,
    imageUrl: row.image_url,
    baseMetal: row.base_metal,
    currentStatus: row.current_status,
    productSegment: row.product_segment,
    totPolkiWt: row.tot_polki_wt,
    totColorStoneWt: row.tot_color_stone_wt,
    motif: row.motif,
    motifCategory: row.motif_category,
  };

  return {
    jewelCode: row.jewel_code,
    total,
    breakdown: {
      segment: Math.round(segNorm * 100) / 100,
      category: Math.round(catNorm * 100) / 100,
      visual: Math.round(vNorm * 100) / 100,
      price: Math.round(priNorm * 100) / 100,
      bonus,
    },
    reasons,
    inventoryData: candidate,
  };
}

// ── Formula-only fallback (no vectors available) ────────────────────────────

function formulaScoreCandidate(
  candidate: InventoryCandidate,
  profile: BdmStyleProfile,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): AiScoredItem & { inventoryData: InventoryCandidate } {
  const reasons: ScoredItemReason[] = [];
  const clientPrefs = profile.clientPreferences;

  // ── 1. SEGMENT (0-1) ──
  const prefSegs = clientPrefs?.primarySegments || profile.preferredSegments || [];
  const seg = candidate.productSegment || "";
  let segNorm = 0.2;
  if (seg && prefSegs.some(ps => seg.toLowerCase().includes(ps.toLowerCase()))) {
    segNorm = 1.0;
  } else if (seg) {
    segNorm = 0.3;
  }

  // ── 2. CATEGORY (0-1) ──
  const prefCats = clientPrefs?.preferredCategories || profile.preferredCategories;
  const cat = candidate.category?.toLowerCase() || "";
  let catNorm = 0.3;
  if (prefCats.some(pc => cat.includes(pc.toLowerCase()))) {
    catNorm = 0.8;
  }

  // ── 3. VISUAL (0-1): composite of stones (50%) + motifs (50%) ──
  let stoneScore = 0.4;
  if (clientPrefs && clientPrefs.stoneProfile) {
    const gw = parseFloat(candidate.grossWt) || 1;
    const polkiR = (parseFloat(candidate.totPolkiWt) || 0) / gw;
    const diaR = (parseFloat(candidate.totDiaWt) || 0) / gw;
    const csR = (parseFloat(candidate.totColorStoneWt) || 0) / gw;
    const sp = clientPrefs.stoneProfile;
    stoneScore = stoneCosineSim([polkiR, diaR, csR], [sp.avgPolkiRatio, sp.avgDiamondRatio, sp.avgColorStoneRatio]);
  }
  let motifScore = 0.4;
  const prefMotifs = profile.preferredMotifs || [];
  if (candidate.motif && prefMotifs.length > 0) {
    if (prefMotifs.some(m => candidate.motif.toLowerCase().includes(m.toLowerCase()))) {
      motifScore = 1.0;
    } else if (candidate.motifCategory && prefMotifs.some(m => candidate.motifCategory.toLowerCase().includes(m.toLowerCase()))) {
      motifScore = 0.6;
    } else {
      motifScore = 0.2;
    }
  }
  const vNorm = 0.5 * stoneScore + 0.5 * motifScore;

  // ── 4. PRICE (0-1) ──
  let priNorm = 0.3;
  if (clientPrefs && clientPrefs.priceRange.median > 0 && candidate.tagPrice > 0) {
    const deviation = Math.abs(candidate.tagPrice - clientPrefs.priceRange.median) / clientPrefs.priceRange.median;
    if (deviation <= 0.15) priNorm = 1.0;
    else if (deviation <= 0.30) priNorm = 0.7;
    else if (candidate.tagPrice >= clientPrefs.priceRange.min && candidate.tagPrice <= clientPrefs.priceRange.max) priNorm = 0.4;
    else priNorm = 0.1;
  } else {
    const { sweet_spot } = profile.priceRange;
    if (sweet_spot > 0 && candidate.tagPrice > 0) {
      const deviation = Math.abs(candidate.tagPrice - sweet_spot) / sweet_spot;
      if (deviation <= 0.2) priNorm = 0.9;
      else if (deviation <= 0.5) priNorm = 0.6;
    }
  }

  // ── Weighted total ──
  let total = Math.round(
    segNorm * weights.segment +
    catNorm * weights.category +
    vNorm * weights.visual +
    priNorm * weights.price
  );
  let bonus = 0;

  const gp = candidate.tagPrice > 0 ? ((candidate.tagPrice - candidate.costPrice) / candidate.tagPrice) * 100 : 0;
  if (gp >= 50) { total += 3; bonus += 3; }
  else if (gp >= 40) { total += 1; bonus += 1; }

  const locBoost = locationBoost(candidate.location);
  if (locBoost.boost > 0) {
    const lb = Math.min(locBoost.boost, 3); total += lb; bonus += lb;
    if (locBoost.reason) reasons.push({ tag: "pref", text: locBoost.reason });
  }

  total = clamp(total, 0, 100);
  reasons.push({ tag: "formula", text: "Scored by formula — embeddings not yet available" });

  return {
    jewelCode: candidate.jewelCode,
    total,
    breakdown: {
      segment: Math.round(segNorm * 100) / 100,
      category: Math.round(catNorm * 100) / 100,
      visual: Math.round(vNorm * 100) / 100,
      price: Math.round(priNorm * 100) / 100,
      bonus,
    },
    reasons,
    inventoryData: candidate,
  };
}

// ── Set pair injection ─────────────────────────────────────────────────────
// Set suffixes: LNS/LNSE (Long Necklace Set), NS/NSE (Necklace Set),
// CHS/CHSE (Choker Set), PNS/PNSE (Pendant Set), CNS/CNSE (Chain Set).
// Earring halves end in E. Necklaces may have variant suffix like -1, -2.

// All known set-type suffixes (earring first, then necklace)
const SET_SUFFIXES_EARRING = /^(.*?)(NLSE|LNSE|CHSE|PNSE|CNSE|NSE)(-\d+)?$/;
const SET_SUFFIXES_NECKLACE = /^(.*?)(NLS|LNS|CHS|PNS|CNS|NS|CS)(-\d+)?$/;
const SET_SUFFIXES_ANY = /^(.*?)(NLSE|LNSE|CHSE|PNSE|CNSE|NSE|NLS|LNS|CHS|PNS|CNS|NS|CS)(-\d+)?$/;

/** Extract design prefix from a set style code (strips suffix + variant). */
function designPrefix(styleCode: string | undefined): string | null {
  if (!styleCode) return null;
  const s = styleCode.toUpperCase().trim();
  const m = s.match(SET_SUFFIXES_ANY);
  return m ? m[1] : null;
}

/** Returns true if this style code is part of a set (earring or necklace half). */
function isSetItem(styleCode: string | undefined): boolean {
  if (!styleCode) return false;
  return SET_SUFFIXES_ANY.test(styleCode.toUpperCase().trim());
}

/** Returns true if this style code is the earring half. */
function isEarringHalf(styleCode: string | undefined): boolean {
  if (!styleCode) return false;
  return SET_SUFFIXES_EARRING.test(styleCode.toUpperCase().trim());
}

async function injectMissingSetPairs(
  items: Array<AiScoredItem & { inventoryData: InventoryCandidate }>,
  _profile: BdmStyleProfile
): Promise<Array<AiScoredItem & { inventoryData: InventoryCandidate }>> {
  const existingCodes = new Set<string>();
  // Group by design prefix to detect items already paired
  const prefixGroups = new Map<string, Array<AiScoredItem & { inventoryData: InventoryCandidate }>>();

  for (const item of items) {
    existingCodes.add(item.inventoryData.jewelCode);
    const prefix = designPrefix(item.inventoryData.styleNo);
    if (prefix && isSetItem(item.inventoryData.styleNo)) {
      if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
      prefixGroups.get(prefix)!.push(item);
    }
  }

  // Find prefixes with only one half present — need to fetch the pair
  const prefixesNeedingPair: string[] = [];
  for (const [prefix, group] of Array.from(prefixGroups.entries())) {
    if (group.length === 1) prefixesNeedingPair.push(prefix);
  }

  if (prefixesNeedingPair.length === 0) return items;
  console.log(`[assortment-scorer] Looking for missing set pairs for ${prefixesNeedingPair.length} item(s)`);

  // Use LIKE-based prefix search to find the other half
  // E.g., OQCLO47111LNSE → prefix OQCLO47111 → search LIKE 'OQCLO47111%'
  // This handles variant suffixes like -1, -2 automatically
  const likeConditions = prefixesNeedingPair.map(p => `UPPER(TRIM(style_no)) LIKE '${p.replace(/'/g, "''")}%'`);
  const result = await db.execute(sql.raw(`
    SELECT jewel_code, style_no, category, tag_price, cost_price,
           ageing_days, gross_wt, pure_wt, tot_dia_wt, stock_type,
           location, image_url, base_metal, current_status,
           product_segment, tot_polki_wt, tot_color_stone_wt
    FROM live_stock_items
    WHERE (${likeConditions.join(" OR ")})
      AND current_status = 'On Hand'
  `));

  const newItems: Array<AiScoredItem & { inventoryData: InventoryCandidate }> = [];
  for (const row of result.rows as Record<string, unknown>[]) {
    const jc = String(row.jewel_code || "");
    if (existingCodes.has(jc)) continue;

    const rowStyleNo = String(row.style_no || "");
    const rowPrefix = designPrefix(rowStyleNo);
    if (!rowPrefix || !prefixesNeedingPair.includes(rowPrefix)) continue;
    if (!isSetItem(rowStyleNo)) continue;

    const candidate: InventoryCandidate = {
      jewelCode: jc,
      styleNo: rowStyleNo,
      category: String(row.category || ""),
      tagPrice: Number(row.tag_price) || 0,
      costPrice: Number(row.cost_price) || 0,
      ageingDays: Number(row.ageing_days) || 0,
      grossWt: String(row.gross_wt || "0"),
      pureWt: String(row.pure_wt || "0"),
      totDiaWt: String(row.tot_dia_wt || "0"),
      stockType: String(row.stock_type || ""),
      location: String(row.location || ""),
      imageUrl: String(row.image_url || ""),
      baseMetal: String(row.base_metal || ""),
      currentStatus: String(row.current_status || ""),
      productSegment: String(row.product_segment || ""),
      totPolkiWt: String(row.tot_polki_wt || "0"),
      totColorStoneWt: String(row.tot_color_stone_wt || "0"),
      motif: "",
      motifCategory: "",
    };

    // Find the existing pair's score and match it
    const existingPair = prefixGroups.get(rowPrefix)?.[0];
    const pairScore = existingPair ? existingPair.total : 50;

    const locB = locationBoost(candidate.location);
    const reasons: ScoredItemReason[] = [
      { tag: "set", text: `Set pair with ${existingPair?.inventoryData.jewelCode || "matched item"}` },
    ];
    if (locB.reason) reasons.push({ tag: "pref", text: locB.reason });

    newItems.push({
      jewelCode: jc,
      total: pairScore, // same score as its pair — keep together in sorting
      breakdown: { segment: 0.5, category: 0.75, visual: 0.5, price: 0.5, bonus: 0 },
      reasons,
      inventoryData: candidate,
    });
    existingCodes.add(jc);
  }

  if (newItems.length > 0) {
    console.log(`[assortment-scorer] Injected ${newItems.length} missing set pair(s)`);
  }

  return items.concat(newItems);
}

// ── Client preference extraction (deterministic, no AI) ─────────────────

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function extractClientPreferences(
  sales: B2bSalesHistory[],
  clientName: string
): ClientPreferences | null {
  const clientSales = sales.filter(s => (s.clientName || "").trim().toLowerCase() === clientName.trim().toLowerCase());
  if (clientSales.length === 0) return null;

  // Segment distribution
  const segCounts = new Map<string, number>();
  for (const s of clientSales) {
    const seg = (s.productSegment || "").trim();
    if (seg) segCounts.set(seg, (segCounts.get(seg) || 0) + 1);
  }
  const sortedSegs = Array.from(segCounts.entries()).sort((a, b) => b[1] - a[1]);
  const segDist: Record<string, number> = {};
  for (const [seg, cnt] of sortedSegs) segDist[seg] = cnt;

  // Category distribution
  const catCounts = new Map<string, number>();
  for (const s of clientSales) {
    const cat = (s.categoryGroup || s.category || "").trim();
    if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
  }
  const sortedCats = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]);

  // Price range
  const prices = clientSales.map(s => s.finalPrice || s.tagPrice || 0).filter(p => p > 0);
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const priceMedian = median(prices);

  // Weight range
  const weights = clientSales.map(s => parseFloat(s.grossWt || "0")).filter(w => w > 0);
  const weightMin = weights.length > 0 ? Math.min(...weights) : 0;
  const weightMax = weights.length > 0 ? Math.max(...weights) : 0;
  const weightMedian = median(weights);

  // Stone profile
  let polkiSum = 0, diaSum = 0, csSum = 0, stoneCount = 0;
  const colourCounts = new Map<string, number>();
  const matRatioCounts = new Map<string, number>();
  for (const s of clientSales) {
    const grossWt = parseFloat(s.grossWt || "0") || 1;
    const diaWt = parseFloat(s.totDiaWt || "0");
    if (diaWt > 0 || grossWt > 1) {
      diaSum += diaWt / grossWt;
      stoneCount++;
    }
    // Stone colour
    const colour = (s.stoneColour || "").trim();
    if (colour) colourCounts.set(colour, (colourCounts.get(colour) || 0) + 1);
    // Material ratio
    const mr = (s.materialRatio || "").trim();
    if (mr) matRatioCounts.set(mr, (matRatioCounts.get(mr) || 0) + 1);
  }
  const avgDiaRatio = stoneCount > 0 ? diaSum / stoneCount : 0;
  const avgPolkiRatio = polkiSum; // polki weight not in sales schema, default 0
  const avgCsRatio = csSum; // color stone weight not in sales schema, default 0

  const topColours = Array.from(colourCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  const topMatRatio = Array.from(matRatioCounts.entries()).sort((a, b) => b[1] - a[1]);

  return {
    clientName,
    totalTransactions: clientSales.length,
    primarySegments: sortedSegs.slice(0, 3).map(([s]) => s),
    segmentDistribution: segDist,
    preferredCategories: sortedCats.slice(0, 5).map(([c]) => c),
    priceRange: { min: priceMin, max: priceMax, median: priceMedian },
    weightRange: { min: weightMin, max: weightMax, median: weightMedian },
    stoneProfile: {
      avgPolkiRatio,
      avgDiamondRatio: avgDiaRatio,
      avgColorStoneRatio: avgCsRatio,
      preferredColours: topColours,
      materialRatioPreference: topMatRatio.length > 0 ? topMatRatio[0][0] : "",
    },
  };
}

// ── Main scoring orchestrator ──────────────────────────────────────────────

export async function scoreAssortment(
  sales: B2bSalesHistory[],
  candidates: InventoryCandidate[],
  bdmName: string,
  stateName?: string,
  clientName?: string,
  kitSize: number = 100,
  weightMin?: number,
  weightMax?: number,
  weights?: ScoringWeights,
  // Date-scoped runs (month/year filter) pass forceMetadata: the BDM's embedded
  // sales vectors can't be date-filtered, so we build a metadata profile from the
  // date-scoped sales and score via formula. cacheSuffix keeps the period distinct.
  opts?: { forceMetadata?: boolean; cacheSuffix?: string }
): Promise<AiScoreResult> {
  const totalStart = Date.now();

  // ── Check profile cache ──
  const cacheKey = getCacheKey(bdmName, stateName, clientName) + (opts?.cacheSuffix || "");
  const cached = profileCache.get(cacheKey);
  let profile: BdmStyleProfile;
  let profileVector: number[] | null = null;
  let embeddedSalesUsed = 0;
  let profileMs = 0;

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    profile = cached.profile;
    profileVector = cached.profileVector;
    embeddedSalesUsed = cached.embeddedSalesUsed;
    console.log(`[assortment-scorer] Using cached profile for ${bdmName}`);
  } else {
    const profileStart = Date.now();

    if (sales.length === 0) {
      profile = buildFallbackProfile(bdmName);
    } else if (opts?.forceMetadata) {
      // Date-scoped path: build profile from the period-filtered sales only.
      // Use the instant metadata profile (no Gemini call) — embeddings can't be
      // date-filtered, so scoring goes through the formula path regardless, and
      // metadata (categories/segments/price) is all the formula scorer needs.
      profile = buildMetadataProfile(sales, bdmName);
      console.log(`[assortment-scorer] Date-scoped metadata profile built from ${sales.length} period sales`);
    } else {
      // Fetch embedded sales vectors
      const { embeddings } = await fetchBdmSalesEmbeddings(bdmName, stateName, clientName);
      embeddedSalesUsed = embeddings.length;
      console.log(`[assortment-scorer] Found ${embeddedSalesUsed} embedded sales for ${bdmName}`);

      if (embeddings.length >= 3) {
        profileVector = averageVectors(embeddings);
        console.log(`[assortment-scorer] Built profile vector from ${embeddings.length} sales embeddings`);
      }

      // One text-only Gemini call for profile summary
      try {
        profile = await generateProfileSummary(sales, bdmName);
      } catch (err) {
        console.warn("[assortment-scorer] Profile generation failed, using metadata fallback:", err instanceof Error ? err.message : String(err));
        profile = buildMetadataProfile(sales, bdmName);
      }
    }

    profileMs = Date.now() - profileStart;
    profileCache.set(cacheKey, { profile, profileVector, embeddedSalesUsed, createdAt: Date.now() });
    console.log(`[assortment-scorer] Profile built in ${profileMs}ms`);
  }

  // ── Extract client preferences when client is selected ──
  let segmentFilter: string[] | undefined;
  if (clientName && sales.length > 0) {
    const clientPrefs = extractClientPreferences(sales, clientName);
    if (clientPrefs) {
      profile.clientPreferences = clientPrefs;
      if (clientPrefs.primarySegments.length > 0) {
        segmentFilter = clientPrefs.primarySegments;
        console.log(`[assortment-scorer] Client "${clientName}" segment filter: ${segmentFilter.join(", ")}`);
      }
      console.log(`[assortment-scorer] Client preferences: ${clientPrefs.totalTransactions} txns, price ${clientPrefs.priceRange.min}-${clientPrefs.priceRange.max}, weight ${clientPrefs.weightRange.min.toFixed(1)}-${clientPrefs.weightRange.max.toFixed(1)}g`);
    }
  }

  // ── Score items ──
  const scoringStart = Date.now();
  let method: "vector" | "formula" = "formula";
  let finalItems: Array<AiScoredItem & { inventoryData: InventoryCandidate }> = [];

  if (profileVector && profileVector.length === 3072) {
    // Vector path: pgvector similarity search
    method = "vector";
    const maxResults = Math.max(kitSize * 3, 300);
    console.log(`[assortment-scorer] Running vector similarity search (top ${maxResults})...`);

    let vectorResults = await searchSimilarStock(profileVector, maxResults, weightMin, weightMax, segmentFilter);
    console.log(`[assortment-scorer] Vector search returned ${vectorResults.length} results (segment-filtered: ${!!segmentFilter})`);

    // If segment filter returned too few results, retry without filter and merge
    if (segmentFilter && vectorResults.length < kitSize) {
      console.log(`[assortment-scorer] Segment-filtered results (${vectorResults.length}) < kitSize (${kitSize}), backfilling without filter...`);
      const existingCodes = new Set(vectorResults.map(r => r.jewel_code));
      const unfilteredResults = await searchSimilarStock(profileVector, maxResults, weightMin, weightMax);
      const backfill = unfilteredResults.filter(r => !existingCodes.has(r.jewel_code));
      vectorResults = vectorResults.concat(backfill).slice(0, maxResults);
      console.log(`[assortment-scorer] After backfill: ${vectorResults.length} total results`);
    }

    if (vectorResults.length > 0) {
      const sims = vectorResults.map(r => r.similarity);
      const simRange: SimRange = {
        min: Math.min(...sims),
        max: Math.max(...sims),
      };
      console.log(`[assortment-scorer] Similarity range: ${simRange.min.toFixed(4)} - ${simRange.max.toFixed(4)}`);

      const w = weights || DEFAULT_WEIGHTS;
      finalItems = vectorResults.map(row => scoreCandidate(row, profile, simRange, w));
    } else {
      console.warn(`[assortment-scorer] Vector search returned 0 results — falling back to formula scoring`);
      method = "formula";
      let effectiveCandidates = candidates;
      if (effectiveCandidates.length === 0) {
        console.log(`[assortment-scorer] No candidates provided — fetching raw stock from DB`);
        effectiveCandidates = await fetchRawStockCandidates(Math.max(kitSize * 3, 300), weightMin, weightMax, segmentFilter);
        console.log(`[assortment-scorer] Fetched ${effectiveCandidates.length} raw stock candidates`);
      }
      finalItems = effectiveCandidates.map(c => formulaScoreCandidate(c, profile, weights || DEFAULT_WEIGHTS));
    }
  } else {
    // Formula fallback: no profile vector available
    let effectiveCandidates = candidates;
    if (effectiveCandidates.length === 0) {
      console.log(`[assortment-scorer] No candidates provided — fetching raw stock from DB`);
      effectiveCandidates = await fetchRawStockCandidates(Math.max(kitSize * 3, 300), weightMin, weightMax, segmentFilter);
      console.log(`[assortment-scorer] Fetched ${effectiveCandidates.length} raw stock candidates`);
    }
    console.log(`[assortment-scorer] No profile vector — using formula scoring on ${effectiveCandidates.length} candidates`);
    finalItems = effectiveCandidates.map(c => formulaScoreCandidate(c, profile, weights || DEFAULT_WEIGHTS));
  }
  // ── Inject missing set pairs ──
  // If we have a necklace but not its earring (or vice versa), fetch the pair from DB
  finalItems = await injectMissingSetPairs(finalItems, profile);

  // Sort by score descending
  finalItems.sort((a, b) => b.total - a.total);

  const scoringMs = Date.now() - scoringStart;
  const totalMs = Date.now() - totalStart;
  console.log(`[assortment-scorer] Done: ${finalItems.length} items in ${totalMs}ms (profile: ${profileMs}ms, scoring: ${scoringMs}ms, method: ${method})`);

  return {
    items: finalItems,
    profile: {
      ...profile,
      bdmName,
      totalSalesAnalyzed: sales.length,
      embeddedSalesUsed,
    },
    timing: {
      profileMs,
      scoringMs,
      totalMs,
      method,
    },
  };
}

// ── Pure metadata profile (no AI, no API call) ──────────────────────────────

// ── Exhibition Scoring Engine ──────────────────────────────────────────────

export interface ExhibitionSignal {
  parentStyle: string;
  category: string;
  makeType: string;
  interestCount: number;
  customerCount: number;
  exhibitions: string[];
}

export interface ExhibitionScoredItem {
  jewelCode: string;
  styleNo: string;
  category: string;
  tagPrice: number;
  costPrice: number;
  ageingDays: number;
  grossWt: string;
  pureWt: string;
  totDiaWt: string;
  baseMetal: string;
  stockType: string;
  location: string;
  imageUrl: string;
  currentStatus: string;
  score: number;
  matchType: "strong" | "good" | "possible";
  reasons: ScoredItemReason[];
}

// Strip set suffixes to get base family root for matching
const FAMILY_SUFFIX_RE = /^(.*?)(NLSE|LNSE|CHSE|PNSE|CNSE|NSE|NLS|LNS|CHS|PNS|CNS|NS|CS)(-\d+)?$/;
function familyRoot(styleCode: string | undefined): string {
  if (!styleCode) return "";
  const s = styleCode.toUpperCase().trim();
  const m = s.match(FAMILY_SUFFIX_RE);
  return m ? m[1] : s;
}

export async function scoreExhibitionAssortment(
  signals: ExhibitionSignal[],
  kitSize: number = 100
): Promise<{ items: ExhibitionScoredItem[]; signalCount: number }> {
  console.log(`[exhibition-scorer] Scoring against ${signals.length} exhibition signals, kitSize=${kitSize}`);

  // Build lookup maps from signals (matching reference HTML _exhBuildSignals)
  const hotRoots = new Map<string, number>(); // familyRoot → total interest count
  const catWeight = new Map<string, number>(); // category → total interests
  const catClients = new Map<string, number>(); // category → max distinct clients
  const makeWeight = new Map<string, number>(); // makeType → total interests
  const catMakeWeight = new Map<string, number>(); // "CAT||MAKE" → total interests

  for (const sig of signals) {
    const n = sig.interestCount || 1;
    const clients = sig.customerCount || 1;

    // Family root aggregation
    if (sig.parentStyle) {
      const root = familyRoot(sig.parentStyle);
      if (root) hotRoots.set(root, (hotRoots.get(root) || 0) + n);
    }

    const catKey = (sig.category || "").toUpperCase().trim();
    const makeKey = (sig.makeType || "").toUpperCase().trim();

    if (catKey) {
      catWeight.set(catKey, (catWeight.get(catKey) || 0) + n);
      catClients.set(catKey, Math.max(catClients.get(catKey) || 0, clients));
    }
    if (makeKey) {
      makeWeight.set(makeKey, (makeWeight.get(makeKey) || 0) + n);
    }
    if (catKey && makeKey) {
      const k = `${catKey}||${makeKey}`;
      catMakeWeight.set(k, (catMakeWeight.get(k) || 0) + n);
    }
  }

  // Fetch all on-hand live stock
  const maxResults = Math.max(kitSize * 4, 500);
  const result = await db.execute(sql.raw(`
    SELECT
      jewel_code, style_no, category, tag_price, cost_price,
      ageing_days, gross_wt, pure_wt, tot_dia_wt, stock_type,
      location, image_url, base_metal, current_status, make_type
    FROM live_stock_items
    WHERE current_status = 'On Hand'
    ORDER BY tag_price DESC
    LIMIT ${maxResults}
  `));

  const rows = result.rows as Record<string, unknown>[];
  const scored: ExhibitionScoredItem[] = [];

  // Infer make-type from style code prefix (matching reference HTML)
  function inferMakeType(styleNo: string): string {
    const u = styleNo.toUpperCase();
    if (/^OQ/.test(u)) return "OPEN SETTING ANTIQUE";
    if (/^FQ/.test(u)) return "FUSION ANTIQUE";
    if (/^O/.test(u)) return "OPEN SETTING";
    if (/^F/.test(u)) return "FUSION";
    if (/^J/.test(u)) return "JADAU";
    return "";
  }

  for (const row of rows) {
    const styleNo = String(row.style_no || "");
    const category = String(row.category || "");
    const catKey = category.toUpperCase().trim();
    if (!catKey || catKey === "OTHER" || catKey === "MISC") continue;
    const root = familyRoot(styleNo);
    const inferredMake = inferMakeType(styleNo);
    const ageingDays = Number(row.ageing_days) || 0;
    const reasons: ScoredItemReason[] = [];

    let score = 0;

    // +6 Family-root match (matching HTML: "Same family as X past interest(s)")
    const rootInterests = hotRoots.get(root);
    if (root && rootInterests) {
      score += 6;
      reasons.push({ tag: "match", text: `Same family as ${rootInterests} past interest${rootInterests === 1 ? "" : "s"}` });
    }

    // Find best matching exhibition category (forgiving: exact or substring)
    let bestCat: string | null = null;
    let bestCatW = 0;
    for (const [c, w] of Array.from(catWeight.entries())) {
      if ((catKey === c || catKey.includes(c) || c.includes(catKey)) && w > bestCatW) {
        bestCat = c;
        bestCatW = w;
      }
    }

    if (bestCat) {
      const combinedKey = `${bestCat}||${inferredMake}`;
      const compoundW = catMakeWeight.get(combinedKey);
      if (inferredMake && compoundW) {
        // +4 Category × MakeType match
        score += 4;
        reasons.push({ tag: "pref", text: `${bestCat} \u00D7 ${inferredMake} \u2014 ${compoundW} interests` });
      } else {
        // +2 Category-only match
        score += 2;
        const clients = catClients.get(bestCat) || 1;
        reasons.push({ tag: "pref", text: `${bestCat} \u2014 ${bestCatW} interest${bestCatW === 1 ? "" : "s"} across ${clients} client${clients === 1 ? "" : "s"}` });
      }
    } else if (inferredMake && makeWeight.has(inferredMake)) {
      // +1 MakeType-only match
      score += 1;
      reasons.push({ tag: "pref", text: `${inferredMake} \u2014 ${makeWeight.get(inferredMake)} interests in this make-type` });
    }

    // Distinct-client multiplier (capped at +2)
    if (bestCat && (catClients.get(bestCat) || 0) >= 3) {
      score += Math.min(2, Math.log2(catClients.get(bestCat)!));
    }

    // Ageing boost: older items get priority for clearance
    if (ageingDays > 180) {
      score += 1;
      reasons.push({ tag: "clearance", text: `Aged ${ageingDays} days \u2014 priority clearance` });
    } else if (ageingDays > 90) {
      score += 0.5;
      reasons.push({ tag: "slow", text: `${ageingDays} days aged` });
    }

    // Skip items with zero score
    if (score <= 0) continue;

    // Determine match type
    const matchType: "strong" | "good" | "possible" = score >= 8 ? "strong" : score >= 5 ? "good" : "possible";

    scored.push({
      jewelCode: String(row.jewel_code || ""),
      styleNo,
      category,
      tagPrice: Number(row.tag_price) || 0,
      costPrice: Number(row.cost_price) || 0,
      ageingDays,
      grossWt: String(row.gross_wt || "0"),
      pureWt: String(row.pure_wt || "0"),
      totDiaWt: String(row.tot_dia_wt || "0"),
      baseMetal: String(row.base_metal || ""),
      stockType: String(row.stock_type || ""),
      location: String(row.location || ""),
      imageUrl: String(row.image_url || ""),
      currentStatus: String(row.current_status || ""),
      score: Math.round(score * 10) / 10,
      matchType,
      reasons,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Apply diversity cap: max 35% from any single category
  const maxPerCategory = Math.ceil(kitSize * 0.35);
  const capped: ExhibitionScoredItem[] = [];
  const catCount = new Map<string, number>();

  for (const item of scored) {
    const cat = item.category.toUpperCase().trim();
    const count = catCount.get(cat) || 0;
    if (count >= maxPerCategory) continue;
    capped.push(item);
    catCount.set(cat, count + 1);
    if (capped.length >= kitSize * 3) break;
  }

  console.log(`[exhibition-scorer] Scored ${capped.length} items from ${rows.length} stock items`);
  return { items: capped, signalCount: signals.length };
}

function buildMetadataProfile(sales: B2bSalesHistory[], bdmName: string): BdmStyleProfile {
  const categories = new Map<string, number>();
  const stockTypes = new Map<string, number>();
  const motifs = new Set<string>();
  const finishes = new Set<string>();
  let priceSum = 0;
  let priceCount = 0;
  let minPrice = Infinity;
  let maxPrice = 0;

  for (const s of sales) {
    const cat = s.categoryGroup || s.category || "";
    if (cat) categories.set(cat, (categories.get(cat) || 0) + 1);
    if (s.stockType) stockTypes.set(s.stockType, (stockTypes.get(s.stockType) || 0) + 1);
    if (s.motif) motifs.add(s.motif);
    if (s.finish) finishes.add(s.finish);
    if (s.finalPrice && s.finalPrice > 0) {
      priceSum += s.finalPrice;
      priceCount++;
      minPrice = Math.min(minPrice, s.finalPrice);
      maxPrice = Math.max(maxPrice, s.finalPrice);
    }
  }

  const topCategories = Array.from(categories.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat]) => cat);

  const totalStock = Array.from(stockTypes.values()).reduce((a, b) => a + b, 0) || 1;
  const stockPref: Record<string, number> = {};
  for (const [type, count] of Array.from(stockTypes.entries())) {
    stockPref[type] = Math.round((count / totalStock) * 100) / 100;
  }

  const sweetSpot = priceCount > 0 ? Math.round(priceSum / priceCount) : 250000;

  const segments = new Map<string, number>();
  for (const s of sales) {
    if (s.productSegment) segments.set(s.productSegment, (segments.get(s.productSegment) || 0) + 1);
  }
  const topSegments = Array.from(segments.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([seg]) => seg);

  return {
    preferredSegments: topSegments,
    preferredCategories: topCategories,
    priceRange: {
      min: minPrice === Infinity ? 50000 : minPrice,
      max: maxPrice || 500000,
      sweet_spot: sweetSpot,
    },
    visualPatterns: ["Inferred from sales metadata"],
    preferredMotifs: Array.from(motifs).slice(0, 5),
    preferredFinishes: Array.from(finishes).slice(0, 3),
    stockTypePreference: stockPref,
    summary: `${bdmName} has sold ${sales.length} items. Top categories: ${topCategories.join(", ")}. Average sale: ₹${sweetSpot.toLocaleString()}.`,
  };
}
