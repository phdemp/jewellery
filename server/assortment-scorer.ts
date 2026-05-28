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

const RANIWALA_LOCATIONS = ["RANIWALA STORE", "JAIPUR STORE", "JAIPUR STORE L3", "DELHI STORE"];

function scoreCandidate(
  row: VectorScoredRow,
  profile: BdmStyleProfile
): AiScoredItem & { inventoryData: InventoryCandidate } {
  const similarity = row.similarity;
  const ageingDays = row.ageing_days;
  const ageTag = ageingDays <= 90 ? "Fresh" : ageingDays <= 180 ? "Watch" : ageingDays <= 365 ? "Slow" : "Dead Stock";
  const gp = row.tag_price > 0 ? ((row.tag_price - row.cost_price) / row.tag_price) * 100 : 0;
  const reasons: ScoredItemReason[] = [];

  // Visual/embedding similarity (0-35)
  // similarity ranges from ~0.3 (low) to ~0.95 (high match)
  const visualScore = clamp(similarity * 40 - 3, 0, 35);
  if (similarity >= 0.75) reasons.push({ tag: "match", text: `Strong style match (${Math.round(similarity * 100)}% similar to past sales)` });
  else if (similarity >= 0.55) reasons.push({ tag: "match", text: `Moderate style match (${Math.round(similarity * 100)}% similar)` });

  // Category fit (0-20)
  let categoryScore = 5;
  const cat = row.category?.toLowerCase() || "";
  if (profile.preferredCategories.some(pc => cat.includes(pc.toLowerCase()))) {
    categoryScore = 18;
    reasons.push({ tag: "category", text: `${row.category} matches preferred categories` });
  }

  // Price fit (0-15)
  let priceScore = 5;
  const price = row.tag_price;
  const { min: pMin, max: pMax, sweet_spot } = profile.priceRange;
  if (sweet_spot > 0 && price > 0) {
    const deviation = Math.abs(price - sweet_spot) / sweet_spot;
    if (deviation <= 0.2) { priceScore = 14; reasons.push({ tag: "price", text: `₹${price.toLocaleString()} near sweet spot ₹${sweet_spot.toLocaleString()}` }); }
    else if (price >= pMin && price <= pMax) { priceScore = 10; }
    else { priceScore = 3; }
  }

  // Ageing urgency (0-20)
  let ageingScore = 2;
  if (ageTag === "Dead Stock") { ageingScore = 20; reasons.push({ tag: "clearance", text: `Dead stock — ${ageingDays} days aged` }); }
  else if (ageTag === "Slow") { ageingScore = 14; reasons.push({ tag: "slow", text: `Slow mover — ${ageingDays} days` }); }
  else if (ageTag === "Watch") { ageingScore = 8; }
  else { ageingScore = 2; }

  // Uniqueness (0-10)
  let uniqueScore = 5;
  if (similarity < 0.45) { uniqueScore = 9; reasons.push({ tag: "unique", text: "Novel style — discovery opportunity" }); }
  else if (similarity > 0.85) { uniqueScore = 2; }

  let total = visualScore + categoryScore + priceScore + ageingScore + uniqueScore;

  // Margin boost
  if (gp >= 50) total += 5;
  else if (gp >= 40) total += 2;

  // Raniwala location boost
  if (RANIWALA_LOCATIONS.some(loc => (row.location || "").toUpperCase().includes(loc))) {
    total += 6;
    reasons.push({ tag: "pref", text: "Raniwala location — readily available" });
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
      visual: visualScore,
      category: categoryScore,
      price: priceScore,
      ageing: ageingScore,
      uniqueness: uniqueScore,
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
  const ageTag = ageingDays <= 90 ? "Fresh" : ageingDays <= 180 ? "Watch" : ageingDays <= 365 ? "Slow" : "Dead Stock";
  const gp = candidate.tagPrice > 0 ? ((candidate.tagPrice - candidate.costPrice) / candidate.tagPrice) * 100 : 0;
  const reasons: ScoredItemReason[] = [];

  let categoryScore = 5;
  const cat = candidate.category?.toLowerCase() || "";
  if (profile.preferredCategories.some(pc => cat.includes(pc.toLowerCase()))) {
    categoryScore = 18;
  }

  let priceScore = 5;
  const { sweet_spot } = profile.priceRange;
  if (sweet_spot > 0 && candidate.tagPrice > 0) {
    const deviation = Math.abs(candidate.tagPrice - sweet_spot) / sweet_spot;
    if (deviation <= 0.2) priceScore = 14;
    else if (deviation <= 0.5) priceScore = 10;
  }

  let ageingScore = 2;
  if (ageTag === "Dead Stock") { ageingScore = 20; reasons.push({ tag: "clearance", text: `Dead stock — ${ageingDays} days` }); }
  else if (ageTag === "Slow") { ageingScore = 14; reasons.push({ tag: "slow", text: `Slow mover — ${ageingDays} days` }); }
  else if (ageTag === "Watch") ageingScore = 8;

  let total = 10 + categoryScore + priceScore + ageingScore + 5;
  if (gp >= 50) total += 5;

  if (RANIWALA_LOCATIONS.some(loc => (candidate.location || "").toUpperCase().includes(loc))) {
    total += 6;
    reasons.push({ tag: "pref", text: "Raniwala location — readily available" });
  }

  total = clamp(total, 0, 100);
  reasons.push({ tag: "formula", text: "Scored by formula — embeddings not yet available" });

  return {
    jewelCode: candidate.jewelCode,
    total,
    breakdown: { visual: 0, category: categoryScore, price: priceScore, ageing: ageingScore, uniqueness: 5 },
    reasons,
    inventoryData: candidate,
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
  weightMax?: number
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

    finalItems = vectorResults.map(row => scoreCandidate(row, profile));
  } else {
    // Formula fallback: score candidates passed by caller
    console.log(`[assortment-scorer] No profile vector — using formula scoring on ${candidates.length} candidates`);
    finalItems = candidates.map(c => formulaScoreCandidate(c, profile));
  }

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
