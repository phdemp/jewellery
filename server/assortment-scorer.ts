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

export interface BdmStyleProfile {
  preferredCategories: string[];
  priceRange: { min: number; max: number; sweet_spot: number };
  visualPatterns: string[];
  preferredMotifs: string[];
  preferredFinishes: string[];
  stockTypePreference: Record<string, number>;
  summary: string;
}

export interface ScoreBreakdown {
  visual: number;
  category: number;
  price: number;
  ageing: number;
  uniqueness: number;
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
}

async function searchSimilarStock(
  profileVector: number[],
  limit: number,
  weightMin?: number,
  weightMax?: number
): Promise<VectorScoredRow[]> {
  const vectorStr = `[${profileVector.join(",")}]`;

  let whereClause = `current_status = 'On Hand'
    AND embedding_vector IS NOT NULL
    AND embedding_status = 'done'`;

  if (weightMin) {
    whereClause += ` AND CAST(NULLIF(TRIM(gross_wt), '') AS NUMERIC) >= ${Number(weightMin)}`;
  }
  if (weightMax) {
    whereClause += ` AND CAST(NULLIF(TRIM(gross_wt), '') AS NUMERIC) <= ${Number(weightMax)}`;
  }

  const result = await db.execute(sql.raw(`
    SELECT
      jewel_code, style_no, category, tag_price, cost_price,
      ageing_days, gross_wt, pure_wt, tot_dia_wt, stock_type,
      location, image_url, base_metal, current_status,
      1 - (embedding_vector::halfvec(3072) <=> '${vectorStr}'::halfvec(3072)) as similarity
    FROM live_stock_items
    WHERE ${whereClause}
    ORDER BY embedding_vector::halfvec(3072) <=> '${vectorStr}'::halfvec(3072)
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
  visual: number;
  attribute: number;
  velocity: number;
  ageing: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = { visual: 60, attribute: 15, velocity: 15, ageing: 10 };

/** Similarity range from the result set — used to normalize visual scores. */
interface SimRange {
  min: number;
  max: number;
}

function scoreCandidate(
  row: VectorScoredRow,
  profile: BdmStyleProfile,
  _simRange: SimRange,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): AiScoredItem & { inventoryData: InventoryCandidate } {
  const similarity = row.similarity;
  const ageingDays = row.ageing_days;
  const ageTag = ageingDays <= 30 ? "Fresh" : ageingDays <= 60 ? "Active" : ageingDays <= 90 ? "Moderate" : ageingDays <= 180 ? "Slow Moving" : ageingDays <= 270 ? "Ageing" : "Non-Moving";
  const gp = row.tag_price > 0 ? ((row.tag_price - row.cost_price) / row.tag_price) * 100 : 0;
  const reasons: ScoredItemReason[] = [];

  // ── Raw 0-1 normalized scores (stored in breakdown for client re-weighting) ──
  // Each dimension is 0-1. Multiply by weight % to get contribution.
  // Weights sum to 100, so final score is 0-100.

  // Visual: use raw cosine similarity (0-1), not relative-to-result-set normalization.
  // This prevents inflated scores where weak matches get high visual scores just
  // because they're the best in a poor result set.
  const vNorm = Math.max(0, Math.min(1, similarity));

  if (similarity >= 0.75) reasons.push({ tag: "match", text: `Strong style match (${Math.round(similarity * 100)}% similar to past sales)` });
  else if (similarity >= 0.55) reasons.push({ tag: "match", text: `Moderate style match (${Math.round(similarity * 100)}% similar)` });

  // Attribute match (category + price fit) — 0-1
  let aNorm = 0.2; // base
  const cat = row.category?.toLowerCase() || "";
  if (profile.preferredCategories.some(pc => cat.includes(pc.toLowerCase()))) {
    aNorm = 0.6;
    reasons.push({ tag: "category", text: `${row.category} matches preferred categories` });
  }
  const price = row.tag_price;
  const { min: pMin, max: pMax, sweet_spot } = profile.priceRange;
  if (sweet_spot > 0 && price > 0) {
    const deviation = Math.abs(price - sweet_spot) / sweet_spot;
    if (deviation <= 0.2) { aNorm += 0.4; reasons.push({ tag: "price", text: `₹${price.toLocaleString()} near sweet spot ₹${sweet_spot.toLocaleString()}` }); }
    else if (price >= pMin && price <= pMax) { aNorm += 0.2; }
  }
  aNorm = Math.min(aNorm, 1.0);

  // Sales velocity (margin as proxy) — 0-1
  let pNorm = 0.3;
  if (gp >= 50) { pNorm = 1.0; }
  else if (gp >= 40) { pNorm = 0.7; }
  else if (gp >= 30) { pNorm = 0.5; }

  // Ageing urgency — 0-1
  let agNorm = 0.1;
  if (ageTag === "Non-Moving") { agNorm = 1.0; reasons.push({ tag: "clearance", text: `Non-moving stock — ${ageingDays} days aged` }); }
  else if (ageTag === "Ageing") { agNorm = 0.85; reasons.push({ tag: "clearance", text: `Ageing inventory — ${ageingDays} days aged` }); }
  else if (ageTag === "Slow Moving") { agNorm = 0.65; reasons.push({ tag: "slow", text: `Slow moving — ${ageingDays} days` }); }
  else if (ageTag === "Moderate") { agNorm = 0.4; }
  else if (ageTag === "Active") { agNorm = 0.2; }

  // Uniqueness — 0-1
  let uNorm = 0.4;
  if (similarity < 0.35) { uNorm = 0.7; reasons.push({ tag: "unique", text: "Novel style — discovery opportunity" }); }
  else if (similarity > 0.85) { uNorm = 0.2; }

  // Weighted total: norms × weights
  let total = Math.round(
    vNorm * weights.visual +
    aNorm * weights.attribute +
    pNorm * weights.velocity +
    agNorm * weights.ageing
  );

  // Location boost — small additive (max +3), kept outside weights
  const locBoost = locationBoost(row.location);
  if (locBoost.boost > 0) {
    total += Math.min(locBoost.boost, 3);
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
  };

  return {
    jewelCode: row.jewel_code,
    total,
    breakdown: {
      visual: Math.round(vNorm * 100) / 100,
      category: Math.round(aNorm * 100) / 100,
      price: Math.round(pNorm * 100) / 100,
      ageing: Math.round(agNorm * 100) / 100,
      uniqueness: Math.round(uNorm * 100) / 100,
    },
    reasons,
    inventoryData: candidate,
  };
}

// ── Formula-only fallback (no vectors available) ────────────────────────────

function formulaScoreCandidate(
  candidate: InventoryCandidate,
  profile: BdmStyleProfile
): AiScoredItem & { inventoryData: InventoryCandidate } {
  const ageingDays = candidate.ageingDays;
  const ageTag = ageingDays <= 30 ? "Fresh" : ageingDays <= 60 ? "Active" : ageingDays <= 90 ? "Moderate" : ageingDays <= 180 ? "Slow Moving" : ageingDays <= 270 ? "Ageing" : "Non-Moving";
  const gp = candidate.tagPrice > 0 ? ((candidate.tagPrice - candidate.costPrice) / candidate.tagPrice) * 100 : 0;
  const reasons: ScoredItemReason[] = [];

  // No visual similarity available in formula mode
  const vNorm = 0;

  let aNorm = 0.2;
  const cat = candidate.category?.toLowerCase() || "";
  if (profile.preferredCategories.some(pc => cat.includes(pc.toLowerCase()))) {
    aNorm = 0.8;
  }

  let pNorm = 0.3;
  const { sweet_spot } = profile.priceRange;
  if (sweet_spot > 0 && candidate.tagPrice > 0) {
    const deviation = Math.abs(candidate.tagPrice - sweet_spot) / sweet_spot;
    if (deviation <= 0.2) pNorm = 0.9;
    else if (deviation <= 0.5) pNorm = 0.6;
  }

  let agNorm = 0.1;
  if (ageTag === "Non-Moving") { agNorm = 1.0; reasons.push({ tag: "clearance", text: `Non-moving stock — ${ageingDays} days` }); }
  else if (ageTag === "Ageing") { agNorm = 0.85; reasons.push({ tag: "clearance", text: `Ageing inventory — ${ageingDays} days` }); }
  else if (ageTag === "Slow Moving") { agNorm = 0.65; reasons.push({ tag: "slow", text: `Slow moving — ${ageingDays} days` }); }
  else if (ageTag === "Moderate") { agNorm = 0.4; }
  else if (ageTag === "Active") { agNorm = 0.2; }

  // Use default weights since no BDM weights in formula path
  let total = Math.round(
    vNorm * DEFAULT_WEIGHTS.visual +
    aNorm * DEFAULT_WEIGHTS.attribute +
    pNorm * DEFAULT_WEIGHTS.velocity +
    agNorm * DEFAULT_WEIGHTS.ageing
  );
  if (gp >= 50) total += 3;
  else if (gp >= 40) total += 1;

  const locBoost = locationBoost(candidate.location);
  if (locBoost.boost > 0) {
    total += Math.min(locBoost.boost, 3);
    if (locBoost.reason) reasons.push({ tag: "pref", text: locBoost.reason });
  }

  total = clamp(total, 0, 100);
  reasons.push({ tag: "formula", text: "Scored by formula — embeddings not yet available" });

  return {
    jewelCode: candidate.jewelCode,
    total,
    breakdown: {
      visual: 0,
      category: Math.round(aNorm * 100) / 100,
      price: Math.round(pNorm * 100) / 100,
      ageing: Math.round(agNorm * 100) / 100,
      uniqueness: 0.4,
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
           location, image_url, base_metal, current_status
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
      breakdown: { visual: 0, category: 0.75, price: 0.5, ageing: 0.25, uniqueness: 0.5 },
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
  weights?: ScoringWeights
): Promise<AiScoreResult> {
  const totalStart = Date.now();

  // ── Check profile cache ──
  const cacheKey = getCacheKey(bdmName, stateName, clientName);
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

  // ── Score items ──
  const scoringStart = Date.now();
  let method: "vector" | "formula" = "formula";
  let finalItems: Array<AiScoredItem & { inventoryData: InventoryCandidate }> = [];

  if (profileVector && profileVector.length === 3072) {
    // Vector path: pgvector similarity search
    method = "vector";
    const maxResults = Math.max(kitSize * 3, 300);
    console.log(`[assortment-scorer] Running vector similarity search (top ${maxResults})...`);

    const vectorResults = await searchSimilarStock(profileVector, maxResults, weightMin, weightMax);
    console.log(`[assortment-scorer] Vector search returned ${vectorResults.length} results`);

    // Compute similarity range for normalization — avoids clustered scores
    const sims = vectorResults.map(r => r.similarity);
    const simRange: SimRange = {
      min: sims.length > 0 ? Math.min(...sims) : 0,
      max: sims.length > 0 ? Math.max(...sims) : 1,
    };
    console.log(`[assortment-scorer] Similarity range: ${simRange.min.toFixed(4)} - ${simRange.max.toFixed(4)}`);

    const w = weights || DEFAULT_WEIGHTS;
    finalItems = vectorResults.map(row => scoreCandidate(row, profile, simRange, w));
  } else {
    // Formula fallback: score candidates passed by caller
    console.log(`[assortment-scorer] No profile vector — using formula scoring on ${candidates.length} candidates`);
    finalItems = candidates.map(c => formulaScoreCandidate(c, profile));
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

  return {
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
