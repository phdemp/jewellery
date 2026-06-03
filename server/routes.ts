import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { referenceImages, b2cSales as b2cSalesTable, liveStockItems } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { modifyImageWithOpenAI, generateCADImageWithOpenAI, generateMarketingVisualOpenAI } from "./openai-client";
import { generateImageWithGrok, modifyImageWithGrok, generateMarketingVisualGrok, type GrokAspectRatio } from "./grok-client";
import {
  analyzeReferenceImage,
  analyzeDesignMaterials,
  analyzeImageStyle,
  generateTextEmbedding,
  generateImageEmbedding,
  generateJewellerySketch,
  editJewellerySketch,
  modifyJewelleryImage,
  buildDesignContext,
  buildImagePromptJSON,
  type DesignContext,
  type MaterialBreakdown,
  buildMarketingPrompt,
  generateMarketingVisualGemini,
} from "./google-client";
import {
  generateCostingReport,
  type GoldPurity,
  type CostingReport,
  GOLD_PURITY,
} from "./costing";
import { addVector, searchSimilarVectors, clearVectorStore, migrateJsonToVector } from "./vector-store";
import { insertDesignProjectSchema, insertReferenceImageSchema, driveImportRequestSchema, designProjectInputSchema, insertDesignFeedbackSchema, type DesignFeedback, THEME_CODES } from "@shared/schema";
import { addFeedbackVector, updateFeedbackVector, searchSimilarFeedback } from "./feedback-vector-store";
import { fireAndForgetEvaluation } from "./evaluator";
import { getActivePrompt, seedPromptVersions, incrementGenerationCount, activatePromptVersion, invalidatePromptCache, type PromptScope } from "./prompt-registry";
import { extractFolderId, listImagesInFolder, downloadImage } from "./google-drive";
import { startBatchImport, startBatchReembed, getBatchImportStatus } from "./batch-import";
import { searchSimilarStockItems } from "./stock-vector-store";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";
// Lazy-imported inside route handler to avoid blocking route registration
// import { scoreAssortment, type InventoryCandidate } from "./assortment-scorer";

// -- Feedback Enrichment Helpers ------------------------------------------------

/**
 * Sanitize feedback text before injection into AI prompts.
 * Strips control characters and instruction-like patterns that could manipulate the model.
 */
function sanitizeFeedbackText(text: string): string {
  // Strip control characters except newline and tab
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Strip instruction-like patterns (case-insensitive)
  clean = clean.replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?|context)\b/gi, "");
  clean = clean.replace(/\b(system|assistant|user)\s*:/gi, "");
  // Truncate to 500 chars max per entry to prevent context bloat
  if (clean.length > 500) clean = clean.slice(0, 500) + "...";
  return clean.trim();
}

/**
 * Retrieve matching feedback from pgvector and format as prompt injection text.
 * Returns empty string if no matching feedback or on any error.
 * NEVER throws — generation must not fail because of feedback lookup.
 */
async function retrieveFeedbackForPrompt(
  category: string,
  theme: string,
  queryText: string
): Promise<string> {
  try {
    if (!category || !theme || !queryText) return "";

    const queryEmbedding = await generateTextEmbedding(queryText);
    const feedbackEntries = await searchSimilarFeedback(queryEmbedding, category, theme, 5);

    if (feedbackEntries.length === 0) return "";

    console.log(`[feedback-enrichment] Injecting ${feedbackEntries.length} feedback entries for ${category}/${theme}`);

    const lines: string[] = ["\n\n--- DESIGNER FEEDBACK (apply these learned preferences) ---"];
    for (const entry of feedbackEntries) {
      const sanitized = sanitizeFeedbackText(entry.feedbackText);
      if (!sanitized) continue;
      if (entry.sentiment === "positive") {
        lines.push(`EMPHASIZE: ${sanitized}`);
      } else {
        lines.push(`AVOID: ${sanitized}`);
      }
    }
    lines.push("--- END FEEDBACK ---\n");

    return lines.join("\n");
  } catch (error) {
    console.warn("[feedback-enrichment] Retrieval failed, skipping feedback injection:", error instanceof Error ? error.message : String(error));
    Sentry.captureException(error);
    return "";
  }
}

// ── Style Inspiration Descriptions ──────────────────────────────────────────
const STYLE_INSPIRATION_DESCRIPTIONS: Record<string, string> = {
  "Cartier": "Cartier-inspired: clean geometric lines, Art Deco symmetry, panther motifs, bold bezels, refined luxury with minimal ornamentation",
  "Bvlgari": "Bvlgari-inspired: bold Italian design, cabochon-cut colored gemstones, chunky gold links, Roman coin motifs, vibrant color contrasts",
  "Van Cleef & Arpels": "Van Cleef & Arpels-inspired: Alhambra clover motifs, Mystery Set technique, delicate floral filigree, feminine whimsy, nature-inspired fantasy",
  "Harry Winston": "Harry Winston-inspired: maximum diamond coverage, cluster settings, wreath/floral arrangements of large stones, platinum-look metalwork, red-carpet glamour",
  "Chaumet": "Chaumet-inspired: French neoclassical tiara heritage, laurel-leaf motifs, delicate milgrain edges, regal symmetry, wheat-sheaf patterns",
  "Graff": "Graff-inspired: dramatic oversized stones, cascading diamond drops, bold statement pieces, extraordinary carat weight, clean modern lines",
  "Sabyasachi Jewellery": "Sabyasachi-inspired: heritage Bengal craft, heavy uncut polki sets, Victorian-colonial fusion, jadau technique, ornate layered necklaces with traditional Indian maximalism",
  "Amrapali Jewels": "Amrapali-inspired: Rajasthani royal jewellery, traditional kundan-meena, tribal-meets-luxury, silver and gold mix, intricate hand-crafted motifs from Jaipur tradition",
  "Tanishq": "Tanishq-inspired: modern Indian elegance, lightweight wearable designs, contemporary interpretation of traditional motifs, refined gold craftsmanship, accessible luxury",
  "Kalyan Jewellers": "Kalyan-inspired: South Indian temple jewellery influence, antique gold finish, traditional motifs (mango, peacock, temple), rich heritage craftsmanship",
  "Royal / Heritage": "Royal heritage style: regal opulence, symmetrical layouts, heavy polki coverage, jadau craftsmanship, Mughal-inspired arches and florals, palatial grandeur",
  "Contemporary Minimal": "Contemporary minimal style: clean lines, negative space, geometric forms, understated elegance, sleek bezels, modern silhouettes with minimal ornamentation",
  "Bold Statement": "Bold statement style: oversized proportions, dramatic visual impact, chunky forms, maximalist approach, eye-catching centerpiece design",
  "Floral / Nature-Inspired": "Floral nature-inspired style: organic flowing lines, realistic flower and leaf motifs, vine tendrils, petal-shaped settings, garden-inspired arrangements",
  "Temple Jewellery": "Temple jewellery style: South Indian devotional motifs (Lakshmi, peacock, mango), heavy antique gold, rubies and emeralds in traditional settings, ornate layered design",
  "Fusion (Modern + Traditional)": "Fusion style: blend traditional Indian craft (kundan, polki) with contemporary Western silhouettes, mix heritage motifs with modern geometry, East-meets-West aesthetic",
};

// Configure multer for file uploads (disk storage for reference images)
const diskStorage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
});

// Configure multer for memory storage (for style override processing)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
});

// ── Design Image Bulk Import ──────────────────────────────────────────────────

// Maps top-level folder names to standard product segment names
const DESIGN_IMAGE_SEGMENT_MAP: Record<string, string> = {
  'Bridal':           'Bridal',
  'Bridal-Lite':      'Bridal Lite',
  'Traditional':      'Traditional',
  'Modern':           'Modern',
  'RTW':              'RTW',
  'Ear Esssentials':  'Ear Essentials',  // note the 3-s typo in folder name
  'Handwear':         'Handwear',
  'Add-ons':          'Add-ons',
};

// Parse theme code from filename: FQBRP04499CHS.JPG → "BRP"
function parseThemeCodeFromFilename(filename: string): string | null {
  const match = filename.match(/^[A-Z]Q?(BRC|BRP|BRU|CLO|CLP|WRD|WRO|SOD|SOO|SOP|SOL)/i);
  if (!match) return null;
  const code = match[1].toUpperCase();
  const codeMap: Record<string, string> = { 'CLP': 'CLO', 'SOL': 'SOO' };
  return codeMap[code] ?? code;
}

// Suffix → piece type mapping (ordered longest-first so NLSE matches before NLS)
const PIECE_TYPE_SUFFIX_MAP: Record<string, string> = {
  'NLSE': 'Necklace Set Earring',
  'NLS':  'Necklace Set',
  'CHSE': 'Choker Set Earring',
  'CHS':  'Choker Set',
  'LNSE': 'Long Necklace Set Earring',
  'LNS':  'Long Necklace Set',
  'PNSE': 'Pendant Set Earring',
  'PN':   'Pendant',
  'ER':   'Earring',
  'NL':   'Necklace',
  'CN':   'Choker Necklace',
  'LN':   'Long Necklace',
  'BR':   'Bracelet',
  'RN':   'Ring',
  'MT':   'Maangtika',
  'KN':   'Kanauti',
  'M':    'Mala',
};

// Parse piece type from filename suffix: OQCLO00878NLS.jpg → "Necklace Set"
function parsePieceTypeFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-\s]\d+$/, '').toUpperCase();
  for (const [suffix, label] of Object.entries(PIECE_TYPE_SUFFIX_MAP)) {
    if (base.endsWith(suffix)) return label;
  }
  return null;
}

interface DesignImageFile {
  sourcePath:     string;
  filename:       string;
  productSegment: string;
  category:       string;
  themeCode:      string | null;
  pieceType:      string | null;
}

// In-memory state for background import job
let designImportJob = {
  running:   false,
  total:     0,
  processed: 0,
  failed:    0,
  skipped:   0,
  errors:    [] as string[],
};

async function runDesignImageImport(files: DesignImageFile[]): Promise<void> {
  const BATCH = 3;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);

    await Promise.allSettled(batch.map(async (file) => {
      try {
        const buf    = await fs.readFile(file.sourcePath);
        const base64 = buf.toString('base64');

        const destName = `${Date.now()}-${file.filename}`;
        const destPath = path.join('uploads', destName);
        await fs.copyFile(file.sourcePath, destPath);

        const thumbPath = path.join('uploads', `thumb_${destName}`);
        await sharp(buf).resize(300, 300, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 80 }).toFile(thumbPath);

        const analysis  = await analyzeReferenceImage(base64);
        const embedding = await generateImageEmbedding(base64);

        const richMetadata = {
          ...analysis,
          productSegment: file.productSegment,
          category:       file.category,
          themeCode:      file.themeCode,
          pieceType:      file.pieceType,
        };

        const ref = await storage.createReferenceImage({
          filename:       file.filename,
          filepath:       destPath,
          thumbnailPath:  thumbPath,
          themeCode:      file.themeCode ?? undefined,
          productSegment: file.productSegment || null,
          category:       file.category || null,
          metadata:       richMetadata,
          embedding:      embedding as any,
        });

        await addVector(ref.id, embedding, richMetadata);

        designImportJob.processed++;
      } catch (err: unknown) {
        designImportJob.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        designImportJob.errors.push(`${file.filename}: ${msg}`);
      }
    }));
  }

  designImportJob.running = false;
}

// ── End Design Image Bulk Import ──────────────────────────────────────────────

// Portrait-oriented jewellery categories for CAD image size selection
const PORTRAIT_CATEGORIES = [
  "Necklace", "Choker", "Long Necklace Set", "Kantha",
  "Hathphool", "Maangtika", "Sheesh Patti", "Nath",
  "Ear Extensions", "Necklace / Necklace Set",
  "Choker / Choker Set", "Long Pendant", "Long Necklace",
];

// Price band → budget mapping for AI costing
const PRICE_BAND_BUDGET: Record<string, { min: number; max: number }> = {
  "0-5 Lakh":       { min: 0,       max: 500000 },
  "5-10 Lakh":      { min: 500000,  max: 1000000 },
  "10-15 Lakh":     { min: 1000000, max: 1500000 },
  "15-25 Lakh":     { min: 1500000, max: 2500000 },
  "25-50 Lakh":     { min: 2500000, max: 5000000 },
  "50 Lakh - 1Cr":  { min: 5000000, max: 10000000 },
};

// Price band → design complexity guidance for image generation
const PRICE_BAND_DESIGN_GUIDANCE: Record<string, string> = {
  "0-5 Lakh":      "BUDGET TIER ₹0–5 Lakh (ENTRY): LIGHTWEIGHT, SIMPLE piece. Minimal stone coverage. Thin gold framework. Clean, uncluttered silhouette. No heavy layering.",
  "5-10 Lakh":     "BUDGET TIER ₹5–10 Lakh (MID): Moderate stone coverage. Medium-weight gold framework. Straightforward structural layout.",
  "10-15 Lakh":    "BUDGET TIER ₹10–15 Lakh (UPPER-MID): Well-filled stone coverage. Moderately intricate gold detailing.",
  "15-25 Lakh":    "BUDGET TIER ₹15–25 Lakh (PREMIUM): Dense stone coverage. Detailed gold framework with layering. Rich overall composition.",
  "25-50 Lakh":    "BUDGET TIER ₹25–50 Lakh (LUXURY): Heavy, elaborate piece. Complex layered gold structure. Maximum stone surface coverage.",
  "50 Lakh - 1Cr": "BUDGET TIER ₹50 Lakh–1 Cr (GRAND): Maximum opulence. Elaborate multi-tier structure. Near-continuous stone surface coverage.",
};

const POLKI_SIZE_DESCRIPTIONS: Record<string, string> = {
  "Far":    "FAR SIZE (1.5+ Sieve) — MASSIVE STATEMENT POLKI. Each stone is so large that only 12–20 total stones fill the entire jewellery surface. Each individual polki must be approximately 1/5 to 1/6 the width of the full piece. Stones pack edge-to-edge with almost no visible gold between them. The polki dominate 85%+ of the visual surface. NO small accent polki anywhere — every stone is a bold, oversized feature stone.",
  "Big":    "BIG SIZE (60 to 1.5 Sieve) — LARGE polki stones. 25–40 total stones cover the piece. Each stone is approximately 1/8 to 1/10 the piece width. Stones are clearly oversized and prominent feature elements — not tiny accents.",
  "Medium": "MEDIUM SIZE (28 to 60 Sieve) — standard polki stones, 2–4 mm each. Regular mid-range size filling the design evenly.",
  "Small":  "SMALL SIZE (under 28 Sieve) — tiny polki accent chips, 1–2 mm each. Used as fine fill or accent only, not as feature stones.",
};

const BRAND_RULES = `You are an Expert Jewellery Designer AI specialising in hand-sketched concept art for Polki, Bridal and Contemporary luxury jewellery.

BRAND CONTEXT:
The jewellery brand focuses on luxury Polki, Bridal and wearable collections inspired by Indian heritage, nature, motifs and contemporary forms.

MANDATORY VIEW ANGLE:
- ALWAYS generate a FLAT FRONT-VIEW (straight-on, facing the viewer)
- NEVER show side views, 3/4 angles, perspective, or tilted angles
- The jewellery must appear as if laid flat on a surface and photographed from directly above, or as a technical front-facing elevation drawing
- Pure 2D jewellery drafting style — no depth, no foreshortening

STYLE RULES (VERY IMPORTANT):
- Thin, clean pencil-like outlines in soft brown or gold
- White polki stones drawn as soft rounded bubbles
- Pastel pink or soft pastel gemstones with gentle colored-pencil shading
- Smooth interior gradients in gems, no sharp edges
- Pure 2D jewellery drafting style (front view)
- Very clean and elegant aesthetic
- No dark outlines, no black cartoon lines
- No realism, no metallic reflections, no photographic lighting
- No background or shadows
- White or beige sketch-paper background
- Rendering should match hand-drawn jewellery design sheets

CATEGORIES:
Long Necklace Set, Choker, Necklace, Bangle, Hathphool, Bracelet, Ring, Kantha, Brooch, Kalangi, Ear Extensions, Maangtika, Sheesh Patti, Buttons, Nath, Lapel Pin

PURPOSE/SEGMENT CODES:
- WRD: Wearable Daily
- WRO: Wearable Occasion
- CLO: Contemporary Luxury Occasion
- SOLD: Solitaire Daily
- SOLO: Solitaire Occasion
- BRC: Bridal Classic
- BRP: Bridal Premium
- BRU: Bridal Ultimate

MOTIF CATEGORIES:
1. Nature Inspired: Lotus, Leaves, Cluster Flowers, Paisley, Paan
2. Animal & Birds: Peacock, Swan, Parrot, Butterfly, Elephant
3. Contemporary Forms: Geometric, Domes, Marquise, Arches, Scallops
4. Celestial: Crescent Moon

FUSION REQUIREMENT: BRU/BRP categories require fusion of 2+ motifs

STONE PREFERENCES:
Use ONLY the stones explicitly listed in the design specifications below. Do NOT add rubies, emeralds, sapphires, or any other colored stones unless they are explicitly requested. Default to pure Polki when no colored stones are specified.

GOLD-TO-STONE RATIO:
Determined entirely by the Polki Size and Material Ratio specified in the design request. Do NOT apply any default gold percentage — follow the polki size constraint exactly.

DESIGN RULES:
1. CLO RULE: No animals or birds in CLO designs - use abstract interpretations only
2. Indian heritage proportions must be maintained
3. Clean outlines with accurate stone placements
4. Realistic gold structure with balanced layout based on category
5. Layered long necklaces with scallops + lotus motifs, stone drops only if explicitly requested
6. Big-look rings with central Polki + geometric frame
7. Chokers with paisley + peacock motifs fusing seamlessly
8. Modern scallop-based Polki layouts with Jaali interiors`;

// Condensed preamble for Grok — replaces full BRAND_RULES to stay under Grok's 8000-char prompt limit.
// The imagePrompt already contains all design-specific rules; Grok only needs the style essentials.
const GROK_SKETCH_PREAMBLE = `Hand-drawn jewellery design sketch for a luxury Indian jewellery brand. Flat front-view only — no 3D, no perspective, no tilted angle. White background. Fine pencil linework in soft brown/gold tones. Polki stones as irregular white/off-white uncut diamonds set in gold kundan bezels. Colored gemstones as soft watercolor pastel fills. No text, no labels, no watermarks, no signatures.`;

const CAD_RULES = `You are generating a PHOTOREALISTIC JEWELRY CAD RENDER for Raniwala 1881.

RENDER STYLE:
- Photorealistic 3D product render of the jewellery piece — clean studio product shot
- Render ONLY the jewellery product itself. Do NOT render any software interface, UI elements, menus, toolbars, panels, buttons, axes, grids, or viewport frames
- Metallic gold surfaces: warm 18k yellow gold with accurate specular highlights and reflections
- Gemstones: realistic facets, refractive brilliance, correct transparency and fire
- Studio photography lighting: soft overhead key light, gentle fill, neutral grey-white gradient background
- Sharp clean edges on metal settings; visible prong tips, bezels, wire textures, granulation detail
- NO hand-drawn lines, NO sketchy textures, NO illustration or watercolor style
- Output quality suitable for client presentation and production approval

COMPOSITION:
- CRITICAL: The ENTIRE jewellery piece must be fully visible — every chain, clasp, hook, dangling element, and extension must be COMPLETELY within the frame
- Center the product with at least 15% safe margin on ALL sides
- Scale the product DOWN if needed to ensure nothing is cropped or cut off at any edge
- Slight 3/4 perspective or straight-front view appropriate to the category
- Product only — no background props, models, or lifestyle context

GEMSTONE RULES:
- Polki: irregular rounded cabochon, slight translucency, set in kundan gold bezels
- Faceted stones (emerald, ruby, sapphire): visible internal reflections and facet lines
- All stone settings visible and precisely rendered

OUTPUT: White or light grey gradient background. Single image. No text overlays, no software UI, no menus, no panels, no watermarks. ONLY the jewellery product on a clean background.`;

function buildCADPrompt(context: DesignContext): string {
  const parts: string[] = [
    `Category: ${context.category}`,
    `Theme: ${context.theme}`,
  ];
  if (context.motifs?.length) parts.push(`Motifs: ${context.motifs.join(", ")}`);
  if (context.stones?.length) parts.push(`Gemstones: ${context.stones.join(", ")}`);
  if (context.materialRatio) parts.push(`Material ratio: ${context.materialRatio}`);
  if (context.customNotes) parts.push(`Special instructions: ${context.customNotes}`);

  return `${CAD_RULES}\n\nDESIGN SPECIFICATIONS:\n${parts.join("\n")}`;
}

/** JSON-structured CAD prompt — compact alternative to buildCADPrompt + extraSpecs concat. */
function buildCADPromptJSON(
  context: DesignContext,
  extras: Record<string, string | string[]> = {}
): string {
  const spec: Record<string, unknown> = {
    category: context.category,
    theme: context.theme,
  };
  if (context.motifs?.length) spec.motifs = context.motifs;
  if (context.stones?.length) spec.stones = context.stones;
  if (context.materialRatio) spec.material_ratio = context.materialRatio;
  if (context.customNotes) spec.notes = context.customNotes;

  for (const [key, val] of Object.entries(extras)) {
    if (Array.isArray(val) ? val.length > 0 : val?.trim()) {
      spec[key] = val;
    }
  }

  return `${CAD_RULES}\n\nDESIGN SPECIFICATION:\n${JSON.stringify(spec)}\n\nRender the complete jewellery piece. Every element must be fully visible within frame with at least 15% margin on all sides.`;
}

/** Extract first successful URL from allSettled results, in priority order. */
function firstSuccessfulUrl(results: PromiseSettledResult<string>[]): string | null {
  for (const r of results) {
    if (r.status === "fulfilled") return r.value;
  }
  return null;
}

/** Convert a PromiseSettledResult into a ModelResult. Logs full error server-side and surfaces actual error message to client. */
function toModelResult(result: PromiseSettledResult<string>, model: string): { imageUrl: string | null; error: string | null; model: string } {
  if (result.status === "fulfilled") {
    return { imageUrl: result.value, error: null, model };
  }
  const err = result.reason as Error;
  console.error(`[${model}] generation failed:`, err);
  return { imageUrl: null, error: err?.message || `${model} generation failed`, model };
}

/** Validate polki sieve strings and log counts for debugging. */
function validateBreakdown(breakdown: MaterialBreakdown, category: string): MaterialBreakdown {
  const validSieves = new Set(["8-10", "10-12", "12-14", "14-16"]);
  const validPolki = breakdown.polki.filter(p => {
    if (!validSieves.has(p.sieve)) {
      console.warn(`[costing] Dropping unknown polki sieve "${p.sieve}" — not in STONE_DATA`);
      return false;
    }
    return true;
  });
  const totalPolki = validPolki.reduce((s, p) => s + p.count, 0);
  console.log(`[costing] Polki count for ${category}: ${totalPolki} stones across ${validPolki.length} sieve(s)`);
  return { ...breakdown, polki: validPolki };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Seed prompt versions on startup (no-op if already seeded)
  seedPromptVersions([
    { scope: "brand_rules", text: BRAND_RULES },
    { scope: "cad_rules", text: CAD_RULES },
    { scope: "grok_preamble", text: GROK_SKETCH_PREAMBLE },
  ]).catch(() => { /* table may not exist yet */ });

  // Upload reference image
  app.post("/api/reference-images", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file uploaded" });
      }

      const themeCode      = req.body.themeCode      || null;
      const productSegment = req.body.productSegment  || null;
      const category       = req.body.category        || null;

      // Read the uploaded file as base64
      const fileBuffer = await fs.readFile(req.file.path);
      const base64Image = fileBuffer.toString('base64');

      // Generate thumbnail (300px width for grid display)
      const thumbnailFilename = `thumb_${path.basename(req.file.path)}`;
      const thumbnailPath = path.join('uploads', thumbnailFilename);
      await sharp(fileBuffer)
        .resize(300, 300, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);

      // Analyze the image using Gemini Vision
      const analysis = await analyzeReferenceImage(base64Image);

      // Generate multimodal embedding for similarity search (using image directly)
      const embedding = await generateImageEmbedding(base64Image);

      // Store in database with theme code and thumbnail path
      const referenceImage = await storage.createReferenceImage({
        filename: req.file.originalname,
        filepath: req.file.path,
        thumbnailPath: thumbnailPath,
        themeCode,
        productSegment,
        category,
        metadata: analysis,
        embedding: embedding as any,
      });

      // Add to vector store for similarity search
      await addVector(referenceImage.id, embedding, { ...analysis, themeCode, productSegment, category });

      res.json({
        id: referenceImage.id,
        filename: referenceImage.filename,
        filepath: referenceImage.filepath,
        thumbnailPath: referenceImage.thumbnailPath,
        themeCode: referenceImage.themeCode,
        productSegment: referenceImage.productSegment,
        category: referenceImage.category,
        imageUrl: `/${referenceImage.filepath}`,
        thumbnailUrl: `/${referenceImage.thumbnailPath}`,
        analysis
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error uploading reference image:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all reference images (exclude large embedding data for faster loading)
  app.get("/api/reference-images", async (req, res) => {
    try {
      const images = await storage.getAllReferenceImages();
      // Exclude embedding fields to speed up response - embeddings are only used server-side
      const imagesWithUrls = images.map(({ embedding, embeddingVector, ...img }) => ({
        ...img,
        imageUrl: `/${img.filepath}`,
        thumbnailUrl: img.thumbnailPath ? `/${img.thumbnailPath}` : `/${img.filepath}`,
        analysis: img.metadata
      }));
      res.json(imagesWithUrls);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete reference image
  app.delete("/api/reference-images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const image = await storage.getReferenceImage(id);
      
      if (!image) {
        return res.status(404).json({ error: "Reference image not found" });
      }

      // Delete files from filesystem (original and thumbnail)
      try {
        await fs.unlink(image.filepath);
      } catch (error) {
        console.error("Error deleting file:", error);
      }
      
      // Delete thumbnail if exists
      if (image.thumbnailPath) {
        try {
          await fs.unlink(image.thumbnailPath);
        } catch (error) {
          console.error("Error deleting thumbnail:", error);
        }
      }

      await storage.deleteReferenceImage(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate design sketch
  app.post("/api/generate-design", memoryUpload.single('styleOverride'), async (req, res) => {
    try {
      // Parse form data — new extended fields
      const category = req.body.category;
      const productSegment = req.body.productSegment || "";
      const priceBand = req.body.priceBand || "";
      let polkiSizes: string[] = [];
      try {
        polkiSizes = req.body.polkiSize ? (typeof req.body.polkiSize === "string" ? JSON.parse(req.body.polkiSize) : req.body.polkiSize) : [];
      } catch { polkiSizes = []; }
      let techniques: string[] = [];
      try {
        techniques = req.body.techniques ? (typeof req.body.techniques === "string" ? JSON.parse(req.body.techniques) : req.body.techniques) : [];
      } catch { techniques = []; }
      let motifCategories: string[] = [];
      try {
        const mc = req.body.motifCategory;
        if (mc) { try { motifCategories = JSON.parse(mc); } catch { motifCategories = [mc]; } }
      } catch { motifCategories = []; }
      let motifs: string[] = [];
      try {
        motifs = req.body.motifs ? JSON.parse(req.body.motifs) : [];
      } catch {
        motifs = [];
      }
      let stoneName: string[] = [];
      try { stoneName = req.body.stoneName ? JSON.parse(req.body.stoneName) : []; } catch { stoneName = []; }
      let stoneNameColour: string[] = [];
      try { stoneNameColour = req.body.stoneNameColour ? JSON.parse(req.body.stoneNameColour) : []; } catch { stoneNameColour = []; }
      const stoneShape = req.body.stoneShape || "";
      const goldRatePerGram = Number(req.body.goldRatePerGram) || 0;
      const goldPurityRaw = req.body.goldPurity as string;
      const goldPurity: GoldPurity = (goldPurityRaw && goldPurityRaw in GOLD_PURITY) ? goldPurityRaw as GoldPurity : "18k";
      const goldPercentage = Math.max(5, Math.min(95, parseInt(req.body.goldPercentage as string, 10) || 40));
      const enamel = req.body.enamel || "";
      const finish = req.body.finish || "";
      const designShape = req.body.designShape || "";
      const designType: string = req.body.designType || "";
      const earringStyle = req.body.earringStyle || "";
      const materialRatio = req.body.materialRatio || "Gold Intensive";
      const talaf = req.body.talaf || "";
      const piroiPlacement = req.body.piroiPlacement || "";
      const piroiColour = req.body.piroiColour || "";
      const customNotes = req.body.customNotes || undefined;
      const styleInspiration = req.body.styleInspiration || "";
      const styleOverrideFile = req.file;
      const mode = (req.body.mode as string) === "cad" ? "cad" : "sketch";

      // Map new fields to DB schema (theme = productSegment, stones = stoneName)
      const validatedData = designProjectInputSchema.parse({
        category,
        theme: productSegment || "Modern",
        motifs,
        stones: stoneName,
        materialRatio,
        customNotes
      });

      let similarDesigns: any[] = [];
      let styleOverrideAnalysis: any = null;

      // If style override is provided, analyze it and use it as the primary style reference
      if (styleOverrideFile) {
        const base64Image = styleOverrideFile.buffer.toString('base64');
        styleOverrideAnalysis = await analyzeReferenceImage(base64Image);
      } else {
        // Search for similar designs from Reference Library (no theme filtering — product segments don't map to THEME_CODES)
        const queryText = `${category} ${productSegment} ${motifs.join(' ')} ${customNotes || ''}`;
        const queryEmbedding = await generateTextEmbedding(queryText);
        const similarResults = await searchSimilarVectors(queryEmbedding, 3);
        similarDesigns = similarResults.map(result => result.metadata);
      }

      // Build extra specs for sketchPlan text display
      const polkiSetting: string = req.body.polkiSetting || "";
      const stoneSetting: string = req.body.stoneSetting || "";
      const diamondSetting: string = req.body.diamondSetting || "";
      const extraSpecs: string[] = [];
      if (priceBand) {
        const bandGuidance = PRICE_BAND_DESIGN_GUIDANCE[priceBand];
        extraSpecs.push(`Price Band: ${priceBand}${bandGuidance ? `\n${bandGuidance}` : ""}`);
      }
      if (polkiSetting) extraSpecs.push(`Polki Setting Style: ${polkiSetting}`);
      if (motifCategories.length > 0) extraSpecs.push(`Motif Category: ${motifCategories.join(", ")}`);
      if (stoneName.length > 0) extraSpecs.push(`Stone Names: ${stoneName.join(", ")}`);
      if (stoneNameColour.length > 0) extraSpecs.push(`Stone Colours: ${stoneNameColour.join(", ")}`);
      if (stoneShape) extraSpecs.push(`Stone Shape: ${stoneShape}`);
      if (stoneSetting) extraSpecs.push(`Stone Setting: ${stoneSetting}`);
      if (diamondSetting) extraSpecs.push(`Diamond Setting: ${diamondSetting}`);
      if (enamel) extraSpecs.push(`Enamel: ${enamel}`);
      if (finish) extraSpecs.push(`Finish: ${finish}`);
      if (designShape) extraSpecs.push(`Design Shape: ${designShape}`);
      if (designType) extraSpecs.push(`Design Type: ${designType}`);
      if (techniques.length > 0) extraSpecs.push(`Techniques: ${techniques.join(", ")}`);
      if (earringStyle) extraSpecs.push(`Earring Style: ${earringStyle}`);
      if (talaf && talaf !== "None") extraSpecs.push(`Talaf: ${talaf}`);
      if (piroiPlacement && piroiPlacement !== "None") extraSpecs.push(`Piroi Placement: ${piroiPlacement}`);
      if (piroiColour && piroiColour !== "None") extraSpecs.push(`Piroi Colour: ${piroiColour}`);

      // Build extras for JSON prompt (polki size uses full POLKI_SIZE_DESCRIPTIONS)
      const priceBandGuidance = priceBand ? PRICE_BAND_DESIGN_GUIDANCE[priceBand] || "" : "";
      const extras: Record<string, string | string[]> = {};
      if (productSegment) extras.product_segment = productSegment;
      if (priceBand) extras.price_band = priceBand;
      if (priceBandGuidance) extras.budget_guidance = priceBandGuidance;
      if (polkiSizes.length > 0) {
        extras.polki_size = polkiSizes.includes("Any")
          ? "AI's choice — select the most aesthetically appropriate polki size(s) and mix for this design. You may use any combination of Far (massive), Big, Medium, or Small polki."
          : polkiSizes.map(s => POLKI_SIZE_DESCRIPTIONS[s] || s).join(" | ");
      }
      if (polkiSetting) extras.polki_setting = polkiSetting;
      if (motifCategories.length > 0) {
        extras.motif_category = motifCategories.includes("Any")
          ? "AI's choice — freely select the most fitting motif category and motifs for this design"
          : motifCategories;
      }
      if (stoneNameColour.length > 0) extras.stone_colors = stoneNameColour;
      if (stoneShape) extras.stone_shape = stoneShape;
      if (stoneSetting) extras.stone_setting = stoneSetting;
      if (diamondSetting) extras.diamond_setting = diamondSetting;
      if (enamel) extras.enamel = enamel;
      if (finish) extras.finish = finish;
      if (designShape) extras.design_shape = designShape;
      if (designType) extras.design_type = designType;
      if (techniques.length > 0) extras.techniques = techniques;
      if (earringStyle) extras.earring_style = earringStyle;
      if (talaf && talaf !== "None") extras.talaf = talaf;
      if (piroiPlacement && piroiPlacement !== "None") extras.piroi_placement = piroiPlacement;
      if (piroiColour && piroiColour !== "None") extras.piroi_colour = piroiColour;
      if (styleInspiration) extras.style_inspiration = STYLE_INSPIRATION_DESCRIPTIONS[styleInspiration] || styleInspiration;

      // Build context with brand rules and similar designs
      const resolvedMotifs = motifs.includes("Any")
        ? ["AI's choice — select the most aesthetically appropriate motifs for this design"]
        : validatedData.motifs;
      const context: DesignContext = {
        category: validatedData.category,
        theme: productSegment || "Modern",
        motifs: resolvedMotifs,
        stones: stoneName,
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: styleOverrideAnalysis ? [styleOverrideAnalysis] : similarDesigns
      };

      const fullContext = buildDesignContext(context, BRAND_RULES);

      // Generate sketch plan (detailed, for display)
      let sketchPlan = `Create a design for a **${category}** in the **${productSegment || "Modern"}** segment.\n\n`;
      sketchPlan += `**Structure & Layout:**\n`;
      if (category.toLowerCase().includes('necklace') || category.toLowerCase().includes('choker')) {
        sketchPlan += `- Ensure the piece sits naturally on the neck curve (2D front view).\n`;
        sketchPlan += `- Maintain symmetry unless specified otherwise.\n`;
      }
      sketchPlan += `- Use ${materialRatio} layout style.\n`;
      if (extraSpecs.length > 0) {
        sketchPlan += `\n**Specifications:**\n`;
        extraSpecs.forEach(s => { sketchPlan += `- ${s}\n`; });
      }
      sketchPlan += `\n**Motifs & Elements:**\n`;
      sketchPlan += `- Integrate the following motifs: ${motifs.join(', ') || 'None specified'}.\n`;
      if (stoneName.length > 0) {
        sketchPlan += `- Stones: ${stoneName.join(', ')}.\n`;
      }
      if (stoneNameColour.length > 0) {
        sketchPlan += `- Stone colours: ${stoneNameColour.join(', ')}.\n`;
      }

      if (styleOverrideAnalysis) {
        sketchPlan += `\n**Using user-provided style override reference**\n`;
        sketchPlan += `Style reference: ${styleOverrideAnalysis.description}\n`;
      } else if (similarDesigns.length > 0) {
        sketchPlan += `\n**Informed by ${similarDesigns.length} similar reference design(s) from library**\n`;
      }

      // Generate JSON-structured image prompt
      const imagePrompt = buildImagePromptJSON(context, extras);

      // Retrieve matching feedback and inject into prompt
      const feedbackText = await retrieveFeedbackForPrompt(
        category,
        productSegment || "Modern",
        `${category} ${productSegment} ${motifs.join(" ")} ${stoneName.join(" ")} ${customNotes || ""}`
      );
      const enrichedImagePrompt = imagePrompt + feedbackText;

      // Generate images from all 3 models in parallel
      const isPortrait = PORTRAIT_CATEGORIES.some(c =>
        validatedData.category.toLowerCase().includes(c.toLowerCase())
      );
      const cadSize = isPortrait ? "1024x1536" as const : "1024x1024" as const;
      const grokAspect: GrokAspectRatio = isPortrait ? "3:4" : "1:1";

      const genStart = Date.now();
      const timedGenerate = async (name: string, fn: () => Promise<string>): Promise<string> => {
        const t0 = Date.now();
        try {
          const result = await fn();
          console.log(`[generate-design] ${name} succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          return result;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[generate-design] ${name} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${msg}`);
          throw err;
        }
      };

      // Load active prompts from registry (falls back to hardcoded constants)
      const [activeBrand, activeCad, activeGrok] = await Promise.all([
        getActivePrompt("brand_rules", BRAND_RULES),
        getActivePrompt("cad_rules", CAD_RULES),
        getActivePrompt("grok_preamble", GROK_SKETCH_PREAMBLE),
      ]);

      const [geminiResult, openaiResult, grokResult] = await (async () => {
        if (mode === "cad") {
          // CAD mode: JSON spec prefixed with CAD_RULES (polki size is inside the JSON spec)
          const cadPrompt = buildCADPromptJSON(context, extras) + feedbackText;
          console.log(`[generate-design] CAD PROMPT (${cadPrompt.length} chars):\n${"═".repeat(80)}\n${cadPrompt}\n${"═".repeat(80)}`);
          return Promise.allSettled([
            timedGenerate("Gemini", () => generateJewellerySketch(cadPrompt)),
            timedGenerate("OpenAI", () => generateCADImageWithOpenAI(cadPrompt, cadSize)),
            timedGenerate("Grok", () => generateImageWithGrok(cadPrompt, grokAspect)),
          ]);
        } else {
          // Sketch mode: JSON spec prefixed with active BRAND_RULES from prompt registry
          const fullPrompt = `${activeBrand.text}\n\n${enrichedImagePrompt}`;
          // Grok: use condensed preamble instead of full BRAND_RULES (8000-char limit)
          const grokPrompt = `${activeGrok.text}\n\n${enrichedImagePrompt}`;
          console.log(`[generate-design] FULL PROMPT (${fullPrompt.length} chars), GROK PROMPT (${grokPrompt.length} chars):\n${"═".repeat(80)}\n${fullPrompt}\n${"═".repeat(80)}`);
          return Promise.allSettled([
            timedGenerate("Gemini", () => generateJewellerySketch(fullPrompt)),
            timedGenerate("OpenAI", () => generateCADImageWithOpenAI(fullPrompt, cadSize)),
            timedGenerate("Grok", () => generateImageWithGrok(grokPrompt, grokAspect)),
          ]);
        }
      })();
      console.log(`[generate-design] All models settled in ${((Date.now() - genStart) / 1000).toFixed(1)}s`);

      const generatedImageUrl = firstSuccessfulUrl([geminiResult, openaiResult, grokResult]);
      if (!generatedImageUrl) {
        const errors = [geminiResult, openaiResult, grokResult]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map(r => r.reason?.message).join("; ");
        return res.status(500).json({ error: `All models failed: ${errors}` });
      }

      // Save to database
      const designProject = await storage.createDesignProject({
        ...validatedData,
        sketchPlan,
        imagePrompt,
        generatedImageUrl,
      });

      // ── AI Costing (only when price band + gold rate provided) ──
      let costReport: CostingReport | null = null;
      const budgetRange = priceBand ? PRICE_BAND_BUDGET[priceBand] : undefined;
      if (budgetRange && goldRatePerGram > 0) {
        try {
          const genPath = generatedImageUrl.startsWith("/")
            ? path.join(".", generatedImageUrl)
            : generatedImageUrl;
          const imageBase64 = (await fs.readFile(genPath)).toString("base64");
          const breakdown = await analyzeDesignMaterials(imageBase64, {
            category,
            budget: budgetRange.max,
            materialRatio,
            stones: stoneName,
          });
          const validated = validateBreakdown(breakdown, category);
          costReport = generateCostingReport({
            totalBudget: budgetRange.max,
            goldPercentage,
            goldRatePerGram,
            goldPurity,
            goldWeightGrams: validated.estimatedGoldWeightGrams,
            polki: validated.polki.map(p => ({ sieve: p.sieve, count: p.count })),
            diamond: validated.diamond.map(d => ({ sieve: d.sieve, count: d.count })),
            colorStones: validated.colorStones.map(c => ({ type: c.type, carats: c.carats })),
            emeralds: validated.emeralds.map(e => ({ size_mm: e.size_mm, count: e.count })),
          });
        } catch (costError: any) {
          console.warn(`[generate-design] costing failed: ${costError.message}`);
        }
      }

      res.json({
        id: designProject.id,
        sketchPlan,
        imagePrompt,
        generatedImageUrl,
        usedReferences: styleOverrideAnalysis ? 1 : similarDesigns.length,
        costReport,
        gemini: toModelResult(geminiResult, "gemini-3-pro-image-preview"),
        openai: toModelResult(openaiResult, "gpt-image-1"),
        grok: toModelResult(grokResult, "grok-imagine-image"),
      });

      // ── Fire-and-forget: evaluate each model result + track prompt version ──
      const evalContext = {
        category,
        motifs: motifs || [],
        stones: stoneName || [],
        materialRatio,
        mode: (mode === "cad" ? "cad" : "sketch") as "sketch" | "cad",
      };
      const activeVersionId = mode === "cad" ? activeCad.versionId : activeBrand.versionId;
      incrementGenerationCount(activeVersionId).catch(() => {});

      const geminiUrl = geminiResult.status === "fulfilled" ? geminiResult.value : null;
      const openaiUrl = openaiResult.status === "fulfilled" ? openaiResult.value : null;
      const grokUrl = grokResult.status === "fulfilled" ? grokResult.value : null;

      const evalFn = storage.createEvaluation.bind(storage);
      fireAndForgetEvaluation(designProject.id, "gemini", geminiUrl, evalContext, activeVersionId, evalFn);
      fireAndForgetEvaluation(designProject.id, "openai", openaiUrl, evalContext, activeVersionId, evalFn);
      fireAndForgetEvaluation(designProject.id, "grok", grokUrl, evalContext, activeVersionId, evalFn);
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error generating design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate comparison - two designs: with references and without references
  app.post("/api/generate-comparison", async (req, res) => {
    try {
      const { category, theme, motifs, stones, materialRatio, customNotes } = req.body;

      const validatedData = designProjectInputSchema.parse({
        category,
        theme,
        motifs: motifs || [],
        stones: stones || [],
        materialRatio,
        customNotes
      });

      // Extract theme code for filtering
      const themeMapping = THEME_CODES.find(t => t.name === validatedData.theme);
      const themeCode = themeMapping?.code || null;

      // Search for similar designs from Reference Library
      const queryText = `${validatedData.category} ${validatedData.theme} ${validatedData.motifs.join(' ')} ${validatedData.customNotes || ''}`;
      const queryEmbedding = await generateTextEmbedding(queryText);
      const similarResults = await searchSimilarVectors(queryEmbedding, 3, themeCode || undefined);
      const similarDesigns = similarResults.map(result => ({
        ...result.metadata,
        similarity: Math.round(result.similarity * 100)
      }));

      // Context WITH references
      const contextWithRefs: DesignContext = {
        category: validatedData.category,
        theme: validatedData.theme,
        motifs: validatedData.motifs,
        stones: validatedData.stones || [],
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: similarDesigns
      };

      // Context WITHOUT references (empty similarDesigns = uses defaults)
      const contextWithoutRefs: DesignContext = {
        category: validatedData.category,
        theme: validatedData.theme,
        motifs: validatedData.motifs,
        stones: validatedData.stones || [],
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: []
      };

      // Build prompts for both
      const promptWithRefs = buildImagePromptJSON(contextWithRefs);
      const promptWithoutRefs = buildImagePromptJSON(contextWithoutRefs);

      // Generate both images in parallel
      const [imageWithRefs, imageWithoutRefs] = await Promise.all([
        generateJewellerySketch(BRAND_RULES + "\n\n" + promptWithRefs),
        generateJewellerySketch(BRAND_RULES + "\n\n" + promptWithoutRefs)
      ]);

      res.json({
        withReferences: {
          imageUrl: imageWithRefs,
          prompt: promptWithRefs,
          referencesUsed: similarDesigns.length,
          references: similarDesigns.map(ref => ({
            description: ref.description?.substring(0, 100) + '...',
            similarity: ref.similarity,
            lineStyle: ref.lineStyle,
            coloringTechnique: ref.coloringTechnique
          }))
        },
        withoutReferences: {
          imageUrl: imageWithoutRefs,
          prompt: promptWithoutRefs,
          referencesUsed: 0
        }
      });
    } catch (error: any) {
      console.error("Error generating comparison:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all design projects
  app.get("/api/design-projects", async (req, res) => {
    try {
      const projects = await storage.getAllDesignProjects();
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single design project
  app.get("/api/design-projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const project = await storage.getDesignProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Design project not found" });
      }

      res.json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Edit a design - create new iteration with edits
  app.post("/api/design-projects/:id/edit", async (req, res) => {
    try {
      const { id } = req.params;
      const { editPrompt } = req.body;

      if (!editPrompt || typeof editPrompt !== 'string' || editPrompt.trim().length === 0) {
        return res.status(400).json({ error: "Edit prompt is required" });
      }

      // Get the design project
      const project = await storage.getDesignProject(id);
      if (!project) {
        return res.status(404).json({ error: "Design project not found" });
      }

      // Get the latest iteration or use original image
      const iterations = await storage.getDesignIterations(id);
      const sourceImageUrl = iterations.length > 0 
        ? iterations[iterations.length - 1].resultImageUrl 
        : project.generatedImageUrl;

      if (!sourceImageUrl) {
        return res.status(400).json({ error: "No source image available for editing" });
      }

      // Generate edited image — Gemini preferred, OpenAI fallback
      let editedImageUrl: string;
      try {
        editedImageUrl = await editJewellerySketch(sourceImageUrl, editPrompt.trim());
      } catch (geminiError: any) {
        console.warn(`Gemini sketch edit failed (${geminiError.message}), falling back to OpenAI`);
        const absoluteSourcePath = path.resolve(sourceImageUrl.startsWith('/') ? '.' + sourceImageUrl : sourceImageUrl);
        editedImageUrl = await modifyImageWithOpenAI(absoluteSourcePath, editPrompt.trim());
      }

      // Save the iteration
      const iteration = await storage.createDesignIteration({
        designProjectId: id,
        iterationNumber: iterations.length + 1,
        editPrompt: editPrompt.trim(),
        sourceImageUrl,
        resultImageUrl: editedImageUrl,
      });

      res.json({
        id: iteration.id,
        iterationNumber: iteration.iterationNumber,
        editPrompt: iteration.editPrompt,
        sourceImageUrl: iteration.sourceImageUrl,
        resultImageUrl: iteration.resultImageUrl,
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error editing design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get design iterations
  app.get("/api/design-projects/:id/iterations", async (req, res) => {
    try {
      const { id } = req.params;
      const iterations = await storage.getDesignIterations(id);
      res.json(iterations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save design to organized folder structure: designs/{category}/{theme}/
  app.post("/api/design-projects/:id/save", async (req, res) => {
    try {
      const { id } = req.params;
      const { iterationIndex } = req.body; // Optional: which iteration to save (0 = original)
      
      // Get the design project to get category and theme
      const project = await storage.getDesignProject(id);
      if (!project) {
        return res.status(404).json({ error: "Design project not found" });
      }

      // Get the correct image URL from server-side data (not from client)
      let sourceUrl = project.generatedImageUrl;
      if (typeof iterationIndex === 'number' && iterationIndex > 0) {
        const iterations = await storage.getDesignIterations(id);
        const iteration = iterations[iterationIndex - 1]; // iterationIndex 1 = first edit
        if (iteration) {
          sourceUrl = iteration.resultImageUrl;
        }
      }

      if (!sourceUrl) {
        return res.status(400).json({ error: "No image to save" });
      }

      // Security: Validate that source is within uploads directory
      const normalizedSource = path.normalize(sourceUrl.startsWith('/') ? `.${sourceUrl}` : sourceUrl);
      if (!normalizedSource.startsWith('uploads/') && !normalizedSource.startsWith('./uploads/')) {
        return res.status(400).json({ error: "Invalid image path" });
      }

      // Sanitize category and theme for folder names (remove special chars, replace spaces)
      const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      const categoryFolder = sanitize(project.category);
      const themeFolder = sanitize(project.theme);

      // Create folder structure: designs/{category}/{theme}/
      const designsDir = path.join("designs", categoryFolder, themeFolder);
      await fs.mkdir(designsDir, { recursive: true });

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `design_${timestamp}.png`;
      const destPath = path.join(designsDir, filename);

      // Copy the image from uploads to designs folder
      await fs.copyFile(normalizedSource, destPath);

      res.json({
        success: true,
        savedPath: `/${destPath}`,
        folder: `designs/${categoryFolder}/${themeFolder}`,
        filename
      });
    } catch (error: any) {
      console.error("Error saving design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import images from Google Drive folder via Gemini Batch API
  // Returns immediately — processing happens asynchronously. Poll /api/batch-import/status.
  app.post("/api/import-from-drive", async (req, res) => {
    try {
      const parseResult = driveImportRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid request" });
      }
      const { folderUrl, themeCode } = parseResult.data;
      const result = await startBatchImport(folderUrl, themeCode ?? "");
      if (!result.started) {
        return res.status(409).json({ error: result.error });
      }
      res.json({ message: "Batch import started. Poll /api/batch-import/status for progress.", status: getBatchImportStatus() });
    } catch (error: any) {
      console.error("Error starting batch import:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Poll batch import / reembed progress
  app.get("/api/batch-import/status", (_req, res) => {
    res.json(getBatchImportStatus());
  });

  // Re-analyze and re-embed all reference images via Gemini Batch API
  app.post("/api/reembed-references", async (req, res) => {
    try {
      const result = await startBatchReembed();
      if (!result.started) {
        return res.status(409).json({ error: result.error });
      }
      res.json({ message: "Batch re-embed started. Poll /api/batch-import/status for progress.", status: getBatchImportStatus() });
    } catch (error: any) {
      console.error("Error starting batch re-embed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Migrate existing JSON embeddings to pgvector column
  app.post("/api/migrate-vectors", async (req, res) => {
    try {
      const migrated = await migrateJsonToVector();
      res.json({
        message: `Migrated ${migrated} embeddings from JSON to pgvector`,
        migrated
      });
    } catch (error: any) {
      console.error("Error migrating vectors:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate thumbnails for existing images that don't have them
  app.post("/api/generate-thumbnails", async (req, res) => {
    try {
      const images = await storage.getAllReferenceImages();
      const results: { id: string; filename: string; success: boolean; error?: string }[] = [];

      for (const image of images) {
        try {
          // Skip if already has thumbnail
          if (image.thumbnailPath) {
            results.push({ id: image.id, filename: image.filename, success: true });
            continue;
          }

          // Check if original file exists
          try {
            await fs.access(image.filepath);
          } catch {
            results.push({ id: image.id, filename: image.filename, success: false, error: 'Original file not found' });
            continue;
          }

          // Generate thumbnail
          const fileBuffer = await fs.readFile(image.filepath);
          const thumbnailFilename = `thumb_${path.basename(image.filepath)}`;
          const thumbnailPath = path.join('uploads', thumbnailFilename);
          
          await sharp(fileBuffer)
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);

          // Update database with thumbnail path
          await db.update(referenceImages)
            .set({ thumbnailPath })
            .where(eq(referenceImages.id, image.id));

          console.log(`Generated thumbnail for ${image.filename}`);
          results.push({ id: image.id, filename: image.filename, success: true });
        } catch (error: any) {
          console.error(`Error generating thumbnail for ${image.filename}:`, error);
          results.push({ id: image.id, filename: image.filename, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        message: "Thumbnail generation complete",
        total: images.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      console.error("Error generating thumbnails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Modify an uploaded jewellery image with design parameters
  app.post("/api/modify-design", memoryUpload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Image file is required" });
      }

      // Convert upload to PNG (ensures correct MIME type for Gemini) and save to disk
      const inputFilename = `modify_input_${Date.now()}.png`;
      const inputPath = path.join("uploads", inputFilename);
      const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
      await fs.writeFile(inputPath, pngBuffer);

      // Parse array fields
      let motifs: string[] = [];
      try { motifs = req.body.motifs ? JSON.parse(req.body.motifs) : []; } catch { motifs = []; }
      let stoneName: string[] = [];
      try { stoneName = req.body.stoneName ? JSON.parse(req.body.stoneName) : []; } catch { stoneName = []; }
      let stoneNameColour: string[] = [];
      try { stoneNameColour = req.body.stoneNameColour ? JSON.parse(req.body.stoneNameColour) : []; } catch { stoneNameColour = []; }

      // Parse gold rate and purity for costing
      const goldRatePerGram = Number(req.body.goldRatePerGram) || 0;
      const goldPurityRaw = req.body.goldPurity as string;
      const goldPurity: GoldPurity = (goldPurityRaw && goldPurityRaw in GOLD_PURITY)
        ? goldPurityRaw as GoldPurity : "18k";

      // Build edit prompt — only include non-empty fields
      const modifyPolkiSizes: string[] = req.body.polkiSize ? (typeof req.body.polkiSize === "string" ? (() => { try { return JSON.parse(req.body.polkiSize); } catch { return []; } })() : req.body.polkiSize) : [];
      const modifyPolkiConstraint = modifyPolkiSizes.length > 0
        ? modifyPolkiSizes.includes("Any")
          ? `POLKI STONE SIZE: AI's choice — select the most aesthetically appropriate polki size(s) and mix for this design. You may use any combination of Far (massive), Big, Medium, or Small polki.`
          : `CRITICAL — MANDATORY POLKI STONE SIZE (OVERRIDES ALL OTHER INSTRUCTIONS INCLUDING BUDGET TIER SIEVE SIZES):\nYou MUST use ONLY this polki stone size throughout the modified design:\n${modifyPolkiSizes.map(s => `  • ${POLKI_SIZE_DESCRIPTIONS[s] || s}`).join("\n")}`
        : "";

      // Parse motif category for "Any" handling
      let modifyMotifCategories: string[] = [];
      try { const mc = req.body.motifCategory; if (mc) { try { modifyMotifCategories = JSON.parse(mc); } catch { modifyMotifCategories = [mc]; } } } catch { modifyMotifCategories = []; }

      const lines: string[] = ["Modify this jewellery design according to the following specifications:\n"];
      if (req.body.productSegment) lines.push(`Product Segment: ${req.body.productSegment}`);
      if (req.body.category) lines.push(`Category: ${req.body.category}`);
      if (req.body.priceBand) {
        const modifyBandGuidance = PRICE_BAND_DESIGN_GUIDANCE[req.body.priceBand as string];
        lines.push(`Price Band: ${req.body.priceBand}${modifyBandGuidance ? `\n${modifyBandGuidance}` : ""}`);
      }
      const modifyTechniques: string[] = req.body.techniques ? (typeof req.body.techniques === "string" ? (() => { try { return JSON.parse(req.body.techniques); } catch { return []; } })() : req.body.techniques) : [];
      if (req.body.polkiSetting) lines.push(`Polki Setting Style: ${req.body.polkiSetting}`);
      if (modifyMotifCategories.length > 0) {
        lines.push(`Motif Category: ${modifyMotifCategories.includes("Any") ? "AI's choice — freely select the most fitting motif category" : modifyMotifCategories.join(", ")}`);
      }
      if (motifs.length > 0) {
        lines.push(`Motifs: ${motifs.includes("Any") ? "AI's choice — select the most aesthetically appropriate motifs" : motifs.join(", ")}`);
      }
      if (stoneName.length > 0) lines.push(`Stone Names: ${stoneName.join(", ")}`);
      if (stoneNameColour.length > 0) lines.push(`Stone Name Colours: ${stoneNameColour.join(", ")}`);
      if (req.body.stoneShape) lines.push(`Stone Shape: ${req.body.stoneShape}`);
      if (req.body.stoneSetting) lines.push(`Stone Setting: ${req.body.stoneSetting}`);
      if (req.body.diamondSetting) lines.push(`Diamond Setting: ${req.body.diamondSetting}`);
      if (req.body.enamel) lines.push(`Enamel: ${req.body.enamel}`);
      if (req.body.finish) lines.push(`Finish: ${req.body.finish}`);
      if (req.body.designShape) lines.push(`Design Shape: ${req.body.designShape}`);
      if (req.body.designType) lines.push(`Design Type: ${req.body.designType}`);
      if (modifyTechniques.length > 0) lines.push(`Techniques: ${modifyTechniques.join(", ")}`);
      if (req.body.earringStyle) lines.push(`Earring Style: ${req.body.earringStyle}`);
      if (req.body.materialRatio) lines.push(`Material Ratio: ${req.body.materialRatio}`);
      if (req.body.talaf && req.body.talaf !== "None") lines.push(`Talaf: ${req.body.talaf}`);
      if (req.body.piroiPlacement && req.body.piroiPlacement !== "None") lines.push(`Piroi Placement: ${req.body.piroiPlacement}`);
      if (req.body.piroiColour && req.body.piroiColour !== "None") lines.push(`Piroi Colour: ${req.body.piroiColour}`);
      if (req.body.customNotes) lines.push(`\nAdditional Instructions: ${req.body.customNotes}`);
      const modifyStyleInspiration = req.body.styleInspiration || "";
      if (modifyStyleInspiration) {
        const desc = STYLE_INSPIRATION_DESCRIPTIONS[modifyStyleInspiration] || modifyStyleInspiration;
        lines.push(`Style Inspiration: ${desc}`);
      }

      const editPrompt = lines.join("\n") + (modifyPolkiConstraint ? "\n\n" + modifyPolkiConstraint : "");
      const resolvedPath = path.resolve(inputPath);

      // Retrieve matching feedback and inject into prompt
      const modifyFeedbackText = await retrieveFeedbackForPrompt(
        req.body.category || "Necklace",
        req.body.productSegment || "Modern",
        `${req.body.category || ""} ${req.body.productSegment || ""} ${motifs.join(" ")} ${req.body.customNotes || ""}`
      );
      const enrichedEditPrompt = editPrompt + modifyFeedbackText;

      // Start style detection immediately as a shared promise — all 3 models chain from it
      // so analyzeImageStyle runs in parallel with any sync work and is NOT awaited sequentially.
      // This preserves the same timing as before: style takes ~15s, models start as soon as it resolves.
      const stylePromise = analyzeImageStyle(resolvedPath).catch(() => "jewellery image");

      const buildStyleInstruction = (style: string): string => {
        const s = style.toLowerCase();
        if (s.includes("sketch") || s.includes("drawing") || s.includes("pencil") || s.includes("hand-drawn") || s.includes("line art")) {
          return `OUTPUT STYLE: Hand-drawn jewellery design sketch — pencil/ink outlines on clean white paper background. Same artistic medium as the input. NOT photorealistic. NOT a photo.`;
        }
        if (s.includes("cad") || s.includes("render") || s.includes("3d") || s.includes("computer")) {
          return `OUTPUT STYLE: Photorealistic 3D CAD render — clean studio lighting, metallic gold surfaces, white or neutral background. Same render quality as the input.`;
        }
        return `OUTPUT STYLE: Photorealistic product photography — professional studio lighting, white or neutral background. Do NOT output a sketch, illustration, or cartoon. Match the realism of the input photo.`;
      };

      // Modify the image — all 3 models in parallel, each waiting only on the shared stylePromise
      let settledResults: [PromiseSettledResult<string>, PromiseSettledResult<string>, PromiseSettledResult<string>];
      try {
        settledResults = await Promise.allSettled([
          // Gemini: passes pre-computed style to skip its internal analyzeImageStyle call
          stylePromise.then(style => modifyJewelleryImage(resolvedPath, enrichedEditPrompt, style)),
          // OpenAI: style-aware redesign prompt
          stylePromise.then(style => {
            const openAIEditPrompt = `You are a professional jewellery redesign AI. TASK: Redesign this jewellery piece so the output looks CLEARLY DIFFERENT from the input — apply the specifications below visibly (new motifs, stones, layout as instructed).\n\n${buildStyleInstruction(style)}\n\n${enrichedEditPrompt}`;
            return modifyImageWithOpenAI(resolvedPath, openAIEditPrompt);
          }),
          // Grok: style-aware variation prompt
          stylePromise.then(style => {
            const grokEditPrompt = `${buildStyleInstruction(style)}\n\nTASK: Apply the following design modifications to create a CLEARLY DIFFERENT variation of the uploaded jewellery. Do NOT copy the original — the output must reflect the new specifications.\n\n${enrichedEditPrompt}`;
            return modifyImageWithGrok(resolvedPath, grokEditPrompt);
          }),
        ]) as [PromiseSettledResult<string>, PromiseSettledResult<string>, PromiseSettledResult<string>];
      } finally {
        try { await fs.unlink(inputPath); } catch { /* ignore cleanup errors */ }
      }
      const [geminiResult, openaiResult, grokResult] = settledResults;

      const generatedImageUrl = firstSuccessfulUrl([geminiResult, openaiResult, grokResult]);
      if (!generatedImageUrl) {
        const errors = [geminiResult, openaiResult, grokResult]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map(r => r.reason?.message).join("; ");
        return res.status(500).json({ error: `All models failed: ${errors}` });
      }

      // ── AI Costing: analyze materials + compute cost report ──
      let costReport: CostingReport | null = null;
      const priceBand = req.body.priceBand as string | undefined;
      const budgetRange = priceBand ? PRICE_BAND_BUDGET[priceBand] : undefined;

      if (budgetRange && goldRatePerGram > 0) {
        try {
          // Read the generated image as base64 for Gemini Vision analysis
          const generatedPath = generatedImageUrl.startsWith("/")
            ? path.join(".", generatedImageUrl)
            : generatedImageUrl;
          const generatedBuffer = await fs.readFile(generatedPath);
          const imageBase64 = generatedBuffer.toString("base64");

          const breakdown = await analyzeDesignMaterials(imageBase64, {
            category: req.body.category || "Modification",
            budget: budgetRange.max,
            materialRatio: req.body.materialRatio || "",
            stones: stoneName,
          });

          // Use user-provided gold percentage (slider), or fallback to 40
          const goldPercentage = Math.max(5, Math.min(95,
            parseInt(req.body.goldPercentage as string, 10) || 40
          ));

          const validated = validateBreakdown(breakdown, req.body.category || "Modification");
          costReport = generateCostingReport({
            totalBudget: budgetRange.max,
            goldPercentage,
            goldRatePerGram,
            goldPurity,
            goldWeightGrams: validated.estimatedGoldWeightGrams,
            polki: validated.polki.map(p => ({ sieve: p.sieve, count: p.count })),
            diamond: validated.diamond.map(d => ({ sieve: d.sieve, count: d.count })),
            colorStones: validated.colorStones.map(c => ({ type: c.type, carats: c.carats })),
            emeralds: validated.emeralds.map(e => ({ size_mm: e.size_mm, count: e.count })),
          });

          console.log(`AI costing complete — total estimated: ₹${costReport.totalEstimatedCost.toLocaleString("en-IN")}`);
        } catch (costError: any) {
          console.warn(`AI costing failed (${costError.message}), returning design without cost report`);
        }
      }

      // Save as a design project for iteration support
      const designProject = await storage.createDesignProject({
        category: req.body.category || "Modification",
        theme: req.body.productSegment || "Custom",
        motifs,
        stones: stoneName,
        materialRatio: req.body.materialRatio || "",
        customNotes: req.body.customNotes || "",
        sketchPlan: editPrompt,
        imagePrompt: editPrompt,
        generatedImageUrl,
      });

      res.json({
        id: designProject.id,
        sketchPlan: editPrompt,
        imagePrompt: editPrompt,
        generatedImageUrl,
        usedReferences: 0,
        costReport,
        gemini: toModelResult(geminiResult, "gemini-3-pro-image-preview"),
        openai: toModelResult(openaiResult, "gpt-image-1"),
        grok: toModelResult(grokResult, "grok-imagine-image"),
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error modifying design:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate CAD comparison - same prompt rendered by Gemini and OpenAI side-by-side
  app.post("/api/generate-cad-comparison", async (req, res) => {
    try {
      const {
        productSegment, category, priceBand, polkiSize, polkiSetting: reqPolkiSetting, motifCategory,
        motifs, stoneName, stoneNameColour, stoneShape, stoneSetting: reqStoneSetting, diamondSetting: reqDiamondSetting, materialRatio,
        enamel, finish, designShape, styleInspiration: cadStyleInspiration, designType: cadDesignType, earringStyle,
        talaf, piroiPlacement, piroiColour, customNotes,
        theme,
      } = req.body;
      const cadTechniques: string[] = Array.isArray(req.body.techniques) ? req.body.techniques : [];

      const resolvedCategory = category || "Necklace";
      const resolvedTheme = productSegment || theme || "Modern";
      const cadStoneNames: string[] = Array.isArray(stoneName) ? stoneName : [];
      const cadStoneColours: string[] = Array.isArray(stoneNameColour) ? stoneNameColour : [];
      const cadMotifCategories: string[] = Array.isArray(motifCategory) ? motifCategory : (motifCategory ? [motifCategory] : []);
      const cadGoldRatePerGram = Number(req.body.goldRatePerGram) || 0;
      const cadGoldPurityRaw = req.body.goldPurity as string;
      const cadGoldPurity: GoldPurity = (cadGoldPurityRaw && cadGoldPurityRaw in GOLD_PURITY) ? cadGoldPurityRaw as GoldPurity : "18k";
      const cadGoldPercentage = Math.max(5, Math.min(95, parseInt(req.body.goldPercentage as string, 10) || 40));
      const cadMaterialRatio = materialRatio || "Gold Intensive";

      const validatedData = designProjectInputSchema.parse({
        category: resolvedCategory,
        theme: resolvedTheme,
        motifs: Array.isArray(motifs) ? motifs : [],
        stones: cadStoneNames,
        materialRatio: cadMaterialRatio,
        customNotes,
      });

      const cadResolvedMotifs = (Array.isArray(motifs) && motifs.includes("Any"))
        ? ["AI's choice — select the most aesthetically appropriate motifs for this design"]
        : validatedData.motifs;
      const context: DesignContext = {
        category: validatedData.category,
        theme: validatedData.theme,
        motifs: cadResolvedMotifs,
        stones: cadStoneNames,
        materialRatio: validatedData.materialRatio,
        customNotes: validatedData.customNotes ?? undefined,
        similarDesigns: [],
      };

      // Build extras for JSON CAD prompt (polki size uses full POLKI_SIZE_DESCRIPTIONS)
      const cadPolkiSizes: string[] = Array.isArray(polkiSize) ? polkiSize : (polkiSize ? [polkiSize] : []);
      const cadPolkiSetting: string = reqPolkiSetting || "";
      const cadStoneSetting: string = reqStoneSetting || "";
      const cadDiamondSetting: string = reqDiamondSetting || "";
      const cadPriceBandGuidance = priceBand ? PRICE_BAND_DESIGN_GUIDANCE[priceBand as string] || "" : "";
      const cadExtras: Record<string, string | string[]> = {};
      if (priceBand) cadExtras.price_band = priceBand as string;
      if (cadPriceBandGuidance) cadExtras.budget_guidance = cadPriceBandGuidance;
      if (cadPolkiSizes.length > 0) {
        cadExtras.polki_size = cadPolkiSizes.includes("Any")
          ? "AI's choice — select the most aesthetically appropriate polki size(s) and mix for this design. You may use any combination of Far (massive), Big, Medium, or Small polki."
          : cadPolkiSizes.map(s => POLKI_SIZE_DESCRIPTIONS[s] || s).join(" | ");
      }
      if (cadPolkiSetting) cadExtras.polki_setting = cadPolkiSetting;
      if (cadMotifCategories.length > 0) {
        cadExtras.motif_category = cadMotifCategories.includes("Any")
          ? "AI's choice — freely select the most fitting motif category and motifs for this design"
          : cadMotifCategories;
      }
      if (cadStoneColours.length > 0) cadExtras.stone_colors = cadStoneColours;
      if (stoneShape) cadExtras.stone_shape = stoneShape as string;
      if (cadStoneSetting) cadExtras.stone_setting = cadStoneSetting;
      if (cadDiamondSetting) cadExtras.diamond_setting = cadDiamondSetting;
      if (enamel) cadExtras.enamel = enamel as string;
      if (finish) cadExtras.finish = finish as string;
      if (designShape) cadExtras.design_shape = designShape as string;
      if (cadDesignType) cadExtras.design_type = cadDesignType as string;
      if (cadTechniques.length > 0) cadExtras.techniques = cadTechniques;
      if (earringStyle) cadExtras.earring_style = earringStyle as string;
      if (talaf) cadExtras.talaf = talaf as string;
      if (piroiPlacement) cadExtras.piroi_placement = piroiPlacement as string;
      if (piroiColour) cadExtras.piroi_colour = piroiColour as string;
      if (cadStyleInspiration) cadExtras.style_inspiration = STYLE_INSPIRATION_DESCRIPTIONS[cadStyleInspiration as string] || cadStyleInspiration as string;
      const cadPrompt = buildCADPromptJSON(context, cadExtras);

      // Retrieve matching feedback and inject into prompt
      const cadFeedbackText = await retrieveFeedbackForPrompt(
        resolvedCategory,
        resolvedTheme,
        `${resolvedCategory} ${resolvedTheme} ${(Array.isArray(motifs) ? motifs : []).join(" ")} ${customNotes || ""}`
      );
      const enrichedCadPrompt = cadPrompt + cadFeedbackText;

      // Generate both models in parallel — same prompt, different engines
      // OpenAI failure falls back to Gemini automatically (reuses already-generated Gemini image)
      // Compute aspect ratio based on category
      const cadIsPortrait = PORTRAIT_CATEGORIES.some(c =>
        resolvedCategory.toLowerCase().includes(c.toLowerCase())
      );
      const cadSize = cadIsPortrait ? "1024x1536" as const : "1024x1024" as const;

      const [geminiResult, openaiResult, grokResult] = await Promise.allSettled([
        generateJewellerySketch(enrichedCadPrompt),
        generateCADImageWithOpenAI(enrichedCadPrompt, cadSize),
        generateImageWithGrok(enrichedCadPrompt, cadIsPortrait ? "3:4" : "1:1"),
      ]);

      // At least one model must succeed
      const anySuccess = [geminiResult, openaiResult, grokResult].some(r => r.status === "fulfilled");
      if (!anySuccess) {
        const errors = [geminiResult, openaiResult, grokResult]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map(r => r.reason?.message).join("; ");
        return res.status(500).json({ error: `All models failed: ${errors}` });
      }

      // ── AI Costing (only when price band + gold rate provided) ──
      let cadCostReport: CostingReport | null = null;
      const cadBudgetRange = priceBand ? PRICE_BAND_BUDGET[priceBand] : undefined;
      if (cadBudgetRange && cadGoldRatePerGram > 0) {
        try {
          const cadImageUrl = firstSuccessfulUrl([geminiResult, openaiResult, grokResult]);
          if (cadImageUrl) {
            const cadGenPath = cadImageUrl.startsWith("/") ? path.join(".", cadImageUrl) : cadImageUrl;
            const cadImageBase64 = (await fs.readFile(cadGenPath)).toString("base64");
            const breakdown = await analyzeDesignMaterials(cadImageBase64, {
              category: resolvedCategory,
              budget: cadBudgetRange.max,
              materialRatio: cadMaterialRatio,
              stones: cadStoneNames,
            });
            const validated = validateBreakdown(breakdown, resolvedCategory);
            cadCostReport = generateCostingReport({
              totalBudget: cadBudgetRange.max,
              goldPercentage: cadGoldPercentage,
              goldRatePerGram: cadGoldRatePerGram,
              goldPurity: cadGoldPurity,
              goldWeightGrams: validated.estimatedGoldWeightGrams,
              polki: validated.polki.map(p => ({ sieve: p.sieve, count: p.count })),
              diamond: validated.diamond.map(d => ({ sieve: d.sieve, count: d.count })),
              colorStones: validated.colorStones.map(c => ({ type: c.type, carats: c.carats })),
              emeralds: validated.emeralds.map(e => ({ size_mm: e.size_mm, count: e.count })),
            });
          }
        } catch (costError: any) {
          console.warn(`[generate-cad-comparison] costing failed: ${costError.message}`);
        }
      }

      res.json({
        gemini: toModelResult(geminiResult, "gemini-3-pro-image-preview"),
        openai: toModelResult(openaiResult, "gpt-image-1"),
        grok: toModelResult(grokResult, "grok-imagine-image"),
        prompt: cadPrompt,
        costReport: cadCostReport,
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error generating CAD comparison:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/generate-marketing — Generate marketing visuals with Gemini + OpenAI side-by-side
  app.post("/api/generate-marketing", memoryUpload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Jewellery image is required" });
      }

      // Pre-process image with Sharp for consistent quality
      const processedBuffer = await sharp(req.file.buffer)
        .resize(1024, 1024, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      const base64Image = processedBuffer.toString("base64");

      const {
        jewelleryCategory,
        modelEthnicity,
        modelStyle,
        backgroundSetting,
        lightingMood,
        outfitStyle,
        composition,
        customNotes,
      } = req.body;

      if (!jewelleryCategory || !modelEthnicity || !modelStyle || !backgroundSetting || !lightingMood || !outfitStyle || !composition) {
        return res.status(400).json({ error: "All styling parameters are required" });
      }

      const prompt = buildMarketingPrompt({
        jewelleryCategory,
        modelEthnicity,
        modelStyle,
        backgroundSetting,
        lightingMood,
        outfitStyle,
        composition,
        customNotes: customNotes || undefined,
      });

      // Retrieve matching feedback and inject into prompt
      const marketingFeedbackText = await retrieveFeedbackForPrompt(
        jewelleryCategory,
        "Marketing",
        `${jewelleryCategory} marketing ${modelStyle} ${backgroundSetting} ${customNotes || ""}`
      );
      const enrichedMarketingPrompt = prompt + marketingFeedbackText;

      // Run all 3 AI models in parallel — allSettled so one failure doesn't block the others
      const [geminiResult, openaiResult, grokResult] = await Promise.allSettled([
        generateMarketingVisualGemini(base64Image, enrichedMarketingPrompt),
        generateMarketingVisualOpenAI(base64Image, enrichedMarketingPrompt),
        generateMarketingVisualGrok(base64Image, enrichedMarketingPrompt),
      ]);

      // Ensure designs/marketing directory exists
      const marketingDir = path.join("designs", "marketing");
      await fs.mkdir(marketingDir, { recursive: true });

      let geminiUrl: string | null = null;
      let geminiError: string | null = null;
      let openaiUrl: string | null = null;
      let openaiError: string | null = null;
      let grokUrl: string | null = null;
      let grokError: string | null = null;
      const rand = Math.random().toString(36).slice(2, 8);

      if (geminiResult.status === "fulfilled") {
        const filename = `${Date.now()}-${rand}-gemini.png`;
        const filepath = path.join(marketingDir, filename);
        await fs.writeFile(filepath, Buffer.from(geminiResult.value, "base64"));
        geminiUrl = `/designs/marketing/${filename}`;
      } else {
        console.error("Gemini marketing visual failed:", geminiResult.reason);
        geminiError = "Gemini generation failed";
      }

      if (openaiResult.status === "fulfilled") {
        const filename = `${Date.now()}-${rand}-openai.png`;
        const filepath = path.join(marketingDir, filename);
        await fs.writeFile(filepath, Buffer.from(openaiResult.value, "base64"));
        openaiUrl = `/designs/marketing/${filename}`;
      } else {
        console.error("OpenAI marketing visual failed:", openaiResult.reason);
        openaiError = "OpenAI generation failed";
      }

      if (grokResult.status === "fulfilled") {
        const filename = `${Date.now()}-${rand}-grok.png`;
        const filepath = path.join(marketingDir, filename);
        await fs.writeFile(filepath, Buffer.from(grokResult.value, "base64"));
        grokUrl = `/designs/marketing/${filename}`;
      } else {
        console.error("Grok marketing visual failed:", grokResult.reason);
        grokError = "Grok generation failed";
      }

      // Save to database using the first successful result
      const primaryImageUrl = geminiUrl || openaiUrl || grokUrl;
      let projectId: string | null = null;

      if (primaryImageUrl) {
        const designProject = await storage.createDesignProject({
          category: jewelleryCategory,
          theme: "Marketing",
          motifs: [],
          stones: [],
          materialRatio: "",
          customNotes: customNotes || "",
          sketchPlan: prompt,
          imagePrompt: prompt,
          generatedImageUrl: primaryImageUrl,
        });
        projectId = designProject.id;
      }

      res.json({
        projectId,
        prompt,
        gemini: { imageUrl: geminiUrl, error: geminiError, model: "gemini-3-pro-image-preview" },
        openai: { imageUrl: openaiUrl, error: openaiError, model: "gpt-image-1" },
        grok: { imageUrl: grokUrl, error: grokError, model: "grok-imagine-image" },
      });
    } catch (error: unknown) {
      Sentry.captureException(error);
      console.error("Error generating marketing visual:", error);
      const msg = error instanceof Error ? error.message : "Marketing visual generation failed";
      res.status(500).json({ error: msg });
    }
  });

  // ── POST /api/import-design-images ─────────────────────────────────────────
  app.post("/api/import-design-images", async (_req, res) => {
    if (designImportJob.running) {
      return res.json({ status: 'already_running', ...designImportJob });
    }

    try {
      const designImagesDir = path.join(process.cwd(), 'design images');
      const allFiles: DesignImageFile[] = [];
      const segmentFolders = await fs.readdir(designImagesDir);

      for (const segFolder of segmentFolders) {
        const segPath = path.join(designImagesDir, segFolder);
        const stat    = await fs.stat(segPath);
        if (!stat.isDirectory()) continue;

        const productSegment = DESIGN_IMAGE_SEGMENT_MAP[segFolder] ?? segFolder;
        const segContents    = await fs.readdir(segPath);

        const hasSubfolders = (await Promise.all(
          segContents.map(async (name) => (await fs.stat(path.join(segPath, name))).isDirectory())
        )).some(Boolean);

        if (hasSubfolders) {
          for (const subFolder of segContents) {
            const subPath = path.join(segPath, subFolder);
            if (!(await fs.stat(subPath)).isDirectory()) continue;
            const imageFiles = (await fs.readdir(subPath)).filter(f => /\.(jpe?g)$/i.test(f));
            for (const f of imageFiles) {
              allFiles.push({
                sourcePath:     path.join(subPath, f),
                filename:       f,
                productSegment,
                category:       subFolder,
                themeCode:      parseThemeCodeFromFilename(f),
                pieceType:      parsePieceTypeFromFilename(f),
              });
            }
          }
        } else {
          const imageFiles = segContents.filter(f => /\.(jpe?g)$/i.test(f));
          for (const f of imageFiles) {
            allFiles.push({
              sourcePath:     path.join(segPath, f),
              filename:       f,
              productSegment,
              category:       '',
              themeCode:      parseThemeCodeFromFilename(f),
              pieceType:      parsePieceTypeFromFilename(f),
            });
          }
        }
      }

      const existing      = await storage.getAllReferenceImages();
      const existingNames = new Set(existing.map(r => r.filename));
      const toImport      = allFiles.filter(f => !existingNames.has(f.filename));

      designImportJob = {
        running:   true,
        total:     toImport.length,
        processed: 0,
        failed:    0,
        skipped:   allFiles.length - toImport.length,
        errors:    [],
      };

      runDesignImageImport(toImport).catch(err => {
        console.error('[import-design-images] Background job error:', err instanceof Error ? err.message : String(err));
        designImportJob.running = false;
      });

      res.json({
        status:          'started',
        total:           toImport.length,
        alreadyImported: allFiles.length - toImport.length,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── GET /api/import-design-images/status ────────────────────────────────────
  app.get("/api/import-design-images/status", (_req, res) => {
    res.json(designImportJob);
  });

  // ── POST /api/debug-prompt ──────────────────────────────────────────────────
  // Returns the full assembled prompt WITHOUT calling any AI model.
  // Used by Playwright tests to validate prompt content without burning API credits.
  app.post("/api/debug-prompt", (req, res) => {
    try {
      const category = req.body.category || "Choker";
      const productSegment = req.body.productSegment || "";
      const priceBand = req.body.priceBand || "";
      let polkiSizes: string[] = [];
      try { polkiSizes = req.body.polkiSize ? (typeof req.body.polkiSize === "string" ? JSON.parse(req.body.polkiSize) : req.body.polkiSize) : []; } catch { polkiSizes = []; }
      let techniques: string[] = [];
      try { techniques = req.body.techniques ? (typeof req.body.techniques === "string" ? JSON.parse(req.body.techniques) : req.body.techniques) : []; } catch { techniques = []; }
      let motifCategories: string[] = [];
      try { const mc = req.body.motifCategory; if (mc) { try { motifCategories = JSON.parse(mc); } catch { motifCategories = [mc]; } } } catch { motifCategories = []; }
      let motifs: string[] = [];
      try { motifs = req.body.motifs ? JSON.parse(req.body.motifs) : []; } catch { motifs = []; }
      let stoneName: string[] = [];
      try { stoneName = req.body.stoneName ? JSON.parse(req.body.stoneName) : []; } catch { stoneName = []; }
      let stoneNameColour: string[] = [];
      try { stoneNameColour = req.body.stoneNameColour ? JSON.parse(req.body.stoneNameColour) : []; } catch { stoneNameColour = []; }
      const stoneShape = req.body.stoneShape || "";
      const enamel = req.body.enamel || "";
      const finish = req.body.finish || "";
      const designShape = req.body.designShape || "";
      const designType: string = req.body.designType || "";
      const earringStyle = req.body.earringStyle || "";
      const materialRatio = req.body.materialRatio || "Gold Intensive";
      const talaf = req.body.talaf || "";
      const piroiPlacement = req.body.piroiPlacement || "";
      const piroiColour = req.body.piroiColour || "";
      const customNotes = req.body.customNotes || undefined;
      const polkiSetting: string = req.body.polkiSetting || "";
      const stoneSetting: string = req.body.stoneSetting || "";
      const diamondSetting: string = req.body.diamondSetting || "";
      const debugStyleInspiration: string = req.body.styleInspiration || "";

      // Build extras for JSON prompt (same logic as generate-design)
      const priceBandGuidance = priceBand ? PRICE_BAND_DESIGN_GUIDANCE[priceBand] || "" : "";
      const extras: Record<string, string | string[]> = {};
      if (productSegment) extras.product_segment = productSegment;
      if (priceBand) extras.price_band = priceBand;
      if (priceBandGuidance) extras.budget_guidance = priceBandGuidance;
      if (polkiSizes.length > 0) {
        extras.polki_size = polkiSizes.includes("Any")
          ? "AI's choice — select the most aesthetically appropriate polki size(s) and mix for this design. You may use any combination of Far (massive), Big, Medium, or Small polki."
          : polkiSizes.map(s => POLKI_SIZE_DESCRIPTIONS[s] || s).join(" | ");
      }
      if (polkiSetting) extras.polki_setting = polkiSetting;
      if (motifCategories.length > 0) {
        extras.motif_category = motifCategories.includes("Any")
          ? "AI's choice — freely select the most fitting motif category and motifs for this design"
          : motifCategories;
      }
      if (stoneNameColour.length > 0) extras.stone_colors = stoneNameColour;
      if (stoneShape) extras.stone_shape = stoneShape;
      if (stoneSetting) extras.stone_setting = stoneSetting;
      if (diamondSetting) extras.diamond_setting = diamondSetting;
      if (enamel) extras.enamel = enamel;
      if (finish) extras.finish = finish;
      if (designShape) extras.design_shape = designShape;
      if (designType) extras.design_type = designType;
      if (techniques.length > 0) extras.techniques = techniques;
      if (earringStyle) extras.earring_style = earringStyle;
      if (talaf && talaf !== "None") extras.talaf = talaf;
      if (piroiPlacement && piroiPlacement !== "None") extras.piroi_placement = piroiPlacement;
      if (piroiColour && piroiColour !== "None") extras.piroi_colour = piroiColour;
      if (debugStyleInspiration) extras.style_inspiration = STYLE_INSPIRATION_DESCRIPTIONS[debugStyleInspiration] || debugStyleInspiration;

      // Build context and image prompt (same logic as generate-design, no RAG)
      const debugResolvedMotifs = motifs.includes("Any")
        ? ["AI's choice — select the most aesthetically appropriate motifs for this design"]
        : motifs;
      const context: DesignContext = {
        category,
        theme: productSegment || "Modern",
        motifs: debugResolvedMotifs,
        stones: stoneName,
        materialRatio,
        customNotes,
        similarDesigns: [],
      };

      const imagePrompt = buildImagePromptJSON(context, extras);

      // Determine if pure polki (no colored stones)
      const isPurePolki = stoneName.length === 0;

      // Assemble full prompt (same as generate-design sketch mode)
      const fullPrompt = `${BRAND_RULES}\n\n${imagePrompt}`;

      res.json({
        fullPrompt,
        polkiSizeConstraint: "",
        isPurePolki,
        stonesList: stoneName,
        polkiSizes,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Backfill piece types from filenames ──────────────────────────────────────
  app.post("/api/backfill-piece-types", async (_req, res) => {
    try {
      const allImages = await storage.getAllReferenceImages();
      let updated = 0;
      let skipped = 0;

      for (const img of allImages) {
        const pieceType = parsePieceTypeFromFilename(img.filename);
        if (!pieceType) { skipped++; continue; }

        const meta = (img.metadata as Record<string, unknown>) || {};
        if (meta.pieceType === pieceType) { skipped++; continue; }

        const newMeta = { ...meta, pieceType };
        await storage.updateReferenceImage(img.id, { metadata: newMeta });
        updated++;
      }

      res.json({ updated, skipped, total: allImages.length });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── ASSORTMENT PLANNING ENDPOINTS ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  // Convert Google Drive uc?export=view URLs to local proxy URLs
  function proxyDriveUrl(url: string | null): string | null {
    if (!url) return null;
    const match = url.match(/[?&]id=([\w-]+)/);
    if (match) return `/api/drive-image/${match[1]}`;
    return url;
  }

  // ── Import sales data from Excel ────────────────────────────────────────
  app.post("/api/assortment/import-sales", async (_req, res) => {
    try {
      const filePath = path.resolve("b2b sales data 1 YEAR.xlsx");
      const workbook = xlsxRead(await fs.readFile(filePath));
      // Target "Sheet1" (index 0)
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsxUtils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const toInt = (v: unknown) => v ? Math.round(Number(v)) || null : null;
      const excelSerialToDate = (v: unknown): string => {
        const n = Number(v);
        if (!n || isNaN(n)) return String(v || "");
        return new Date((n - 25569) * 86400000).toISOString().slice(0, 10);
      };
      const sales = rows.map(row => ({
        styleCode: String(row["StyleCode"] || ""),
        bdmName: String(row["SalesPersonName"] || ""),
        jewelSoce: "",
        tag: String(row["TagPrice"] || ""),
        transPrice: toInt(row["TransPrice"]),
        stateName: String(row["StateName"] || ""),
        pureWt: String(row["PureWt"] || ""),
        category: String(row["Category"] || ""),
        makeDays: toInt(row["MakeDays"]),
        billingType: String(row["BillingType"] || ""),
        transactionDate: excelSerialToDate(row["JewelTransDate"]),
        stock: String(row["Stock"] || ""),
        cost: null,
      })).filter(s => s.styleCode !== "");

      await storage.clearB2cSales();
      await storage.bulkCreateB2cSales(sales);

      res.json({ imported: sales.length, sheet: sheetName });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Import stock data from Excel ────────────────────────────────────────
  app.post("/api/assortment/import-stock", async (_req, res) => {
    try {
      const filePath = path.resolve("Stock Item Details.xlsx");
      const workbook = xlsxRead(await fs.readFile(filePath));
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsxUtils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const toIntS = (v: unknown) => v ? Math.round(Number(v)) || null : null;
      const items = rows.map(row => ({
        jewelCode: String(row["Jewel Code"] || row["JewelCode"] || ""),
        styleNo: String(row["Style No"] || row["StyleNo"] || ""),
        imageUrl: String(row["Image_URL"] || ""),
        manufacturer: String(row["Manufacturer"] || ""),
        makeType: String(row["Make Type"] || row["MakeType"] || ""),
        subCategory: String(row["Sub Category"] || row["SubCategory"] || ""),
        stockType: String(row["Stock Type"] || row["StockType"] || ""),
        category: String(row["Category"] || ""),
        collectionGroupName: String(row["Collection Group Name"] || row["CollectionGroupName"] || ""),
        collectionName: String(row["Collection Name"] || row["CollectionName"] || ""),
        baseMetal: String(row["Base Metal"] || row["BaseMetal"] || ""),
        locationName: String(row["Location Name"] || row["LocationName"] || ""),
        status: String(row["Status"] || "Unknown"),
        quantity: toIntS(row["Quantity"]),
        diaWt: String(row["Dia Wt"] || row["DiaWt"] || ""),
        csWt: String(row["CS Wt"] || row["CSWt"] || ""),
        pureWt: String(row["Pure Wt"] || row["PureWt"] || ""),
        totalNetWt: String(row["Total Net Wt"] || row["TotalNetWt"] || ""),
        grossWt: String(row["Gross Wt"] || row["GrossWt"] || ""),
        costPrice: toIntS(row["Cost Price"] || row["CostPrice"]),
        tagPrice: toIntS(row["Tag Price"] || row["TagPrice"]),
        ageingDays: toIntS(row["Ageing Days"] || row["AgeingDays"]),
        sketchDesigner: String(row["Ord_SKETCH_DESIGNER"] || ""),
        labName: String(row["LabName"] || row["Lab Name"] || ""),
        certificateNo: String(row["CertificateNo"] || row["Certificate No"] || ""),
        embeddingStatus: "pending",
      })).filter(s => s.jewelCode !== "");

      await storage.clearStockItems();
      await storage.bulkCreateStockItems(items);

      res.json({ imported: items.length, sheet: sheetName });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Import status ───────────────────────────────────────────────────────
  app.get("/api/assortment/import-status", async (_req, res) => {
    try {
      const salesCount = await db.execute(sql`SELECT COUNT(*)::int as count FROM b2c_sales`);
      const stockCount = await db.execute(sql`SELECT COUNT(*)::int as count FROM stock_items`);
      const embeddedCount = await db.execute(sql`SELECT COUNT(*)::int as count FROM stock_items WHERE embedding_status = 'done'`);
      res.json({
        salesCount: (salesCount.rows[0] as { count: number }).count,
        stockCount: (stockCount.rows[0] as { count: number }).count,
        embeddedCount: (embeddedCount.rows[0] as { count: number }).count,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Embedding pipeline ──────────────────────────────────────────────────
  let embedJob = { running: false, total: 0, processed: 0, failed: 0 };

  app.post("/api/assortment/embed-stock", async (_req, res) => {
    if (embedJob.running) {
      return res.json({ status: "already_running", ...embedJob });
    }

    embedJob = { running: true, total: 0, processed: 0, failed: 0 };

    // Count pending items
    const countResult = await db.execute(sql`SELECT COUNT(*)::int as count FROM stock_items WHERE embedding_status = 'pending'`);
    embedJob.total = (countResult.rows[0] as { count: number }).count;

    res.json({ status: "started", total: embedJob.total });

    // Process in background
    (async () => {
      try {
        const BATCH = 5;
        while (embedJob.running) {
          const items = await storage.getStockItemsPendingEmbedding(BATCH);
          if (items.length === 0) break;

          for (const item of items) {
            try {
              const desc = [
                item.category, item.subCategory, item.collectionName,
                item.baseMetal, item.stockType, item.makeType,
                item.pureWt ? `Pure:${item.pureWt}g` : "",
                item.tagPrice ? `Tag:${item.tagPrice}` : "",
              ].filter(Boolean).join(" ");

              const embedding = await generateTextEmbedding(desc);
              await storage.updateStockItem(item.id, {
                embeddingVector: embedding,
                embeddingStatus: "done",
              } as Partial<typeof item>);
              embedJob.processed++;
            } catch {
              await storage.updateStockItem(item.id, { embeddingStatus: "failed" } as Partial<typeof item>);
              embedJob.failed++;
            }
          }
          // Rate limit pause
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } finally {
        embedJob.running = false;
      }
    })();
  });

  app.get("/api/assortment/embed-stock/status", (_req, res) => {
    res.json(embedJob);
  });

  // ── BDM list ────────────────────────────────────────────────────────────
  app.get("/api/assortment/bdm-list", async (_req, res) => {
    try {
      const bdmNames = await storage.getDistinctBdmNames();
      res.json({ bdmNames });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Stock categories (for assortment filter dropdown) ─────────────────
  app.get("/api/assortment/stock-categories", async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT DISTINCT category FROM live_stock_items
        WHERE category IS NOT NULL AND TRIM(category) <> '' AND current_status = 'On Hand'
        ORDER BY category
      `);
      const categories = (rows.rows as { category: string }[]).map(r => r.category);
      res.json({ categories });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── BDM profile ─────────────────────────────────────────────────────────
  app.get("/api/assortment/bdm-profile/:bdmName", async (req, res) => {
    try {
      const { bdmName } = req.params;
      const sales = await storage.getSalesByBdm(bdmName);

      const totalRevenue = sales.reduce((s, r) => s + (r.transPrice || 0), 0);

      // Top categories
      const catMap = new Map<string, { count: number; revenue: number }>();
      for (const s of sales) {
        const cat = s.category || "Unknown";
        const existing = catMap.get(cat) || { count: 0, revenue: 0 };
        catMap.set(cat, { count: existing.count + 1, revenue: existing.revenue + (s.transPrice || 0) });
      }
      const topCategories = Array.from(catMap.entries())
        .map(([category, data]) => ({ category, ...data }))
        .sort((a, b) => b.count - a.count);

      // Top style codes
      const styleMap = new Map<string, number>();
      for (const s of sales) {
        styleMap.set(s.styleCode, (styleMap.get(s.styleCode) || 0) + 1);
      }
      const topStyleCodes = Array.from(styleMap.entries())
        .map(([styleCode, count]) => ({ styleCode, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // State breakdown
      const stateMap = new Map<string, number>();
      for (const s of sales) {
        const state = s.stateName || "Unknown";
        stateMap.set(state, (stateMap.get(state) || 0) + 1);
      }
      const stateBreakdown = Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);

      res.json({
        bdmName,
        totalSales: sales.length,
        totalRevenue,
        topCategories,
        topStyleCodes,
        stateBreakdown,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Generate AI recommendations ─────────────────────────────────────────
  app.post("/api/assortment/generate-recommendations", async (req, res) => {
    try {
      const { bdmName, stateName, topK = 8 } = req.body as { bdmName: string; stateName?: string; topK?: number };
      if (!bdmName) return res.status(400).json({ error: "bdmName is required" });

      const sales = await storage.getSalesByBdm(bdmName);
      if (sales.length === 0) return res.status(404).json({ error: "No sales found for this BDM" });

      // ── A) Compute BDM's stock-type distribution ──────────────────────
      const uniqueStyleCodes = Array.from(new Set(sales.map(s => s.styleCode)));
      const soldStockItems = await storage.getStockItemsByStyleNos(uniqueStyleCodes);

      // Stock type frequency map (fraction 0-1)
      const stockTypeCount = new Map<string, number>();
      let totalWithType = 0;
      for (const item of soldStockItems) {
        if (item.stockType) {
          stockTypeCount.set(item.stockType, (stockTypeCount.get(item.stockType) || 0) + 1);
          totalWithType++;
        }
      }
      const stockTypeFreq = new Map<string, number>();
      Array.from(stockTypeCount.entries()).forEach(([type, count]) => {
        stockTypeFreq.set(type, totalWithType > 0 ? count / totalWithType : 0);
      });

      // Average stock age from sold items
      const agesOfSold = soldStockItems.filter(i => i.ageingDays != null).map(i => i.ageingDays!);
      const avgStockAge = agesOfSold.length > 0 ? Math.round(agesOfSold.reduce((a, b) => a + b, 0) / agesOfSold.length) : 0;

      // Stock type breakdown (top entries)
      const stockTypeBreakdown = Array.from(stockTypeCount.entries())
        .map(([stockType, count]) => ({ stockType, percentage: totalWithType > 0 ? Math.round((count / totalWithType) * 100) : 0 }))
        .sort((a, b) => b.percentage - a.percentage);

      // ── B) State-influenced price blending ────────────────────────────
      let stateCatPrices = new Map<string, { count: number; avgPrice: number }>();
      if (stateName) {
        const stateSales = await db.select().from(b2cSalesTable)
          .where(sql`${b2cSalesTable.stateName} = ${stateName}`);
        const sCatMap = new Map<string, { count: number; revenue: number }>();
        for (const s of stateSales) {
          const cat = s.category || "Unknown";
          const existing = sCatMap.get(cat) || { count: 0, revenue: 0 };
          sCatMap.set(cat, { count: existing.count + 1, revenue: existing.revenue + (s.transPrice || 0) });
        }
        Array.from(sCatMap.entries()).forEach(([cat, data]) => {
          stateCatPrices.set(cat, { count: data.count, avgPrice: data.count > 0 ? Math.round(data.revenue / data.count) : 0 });
        });
      }

      // Aggregate top 5 categories
      const catMap = new Map<string, { count: number; revenue: number }>();
      for (const s of sales) {
        const cat = s.category || "Unknown";
        const existing = catMap.get(cat) || { count: 0, revenue: 0 };
        catMap.set(cat, { count: existing.count + 1, revenue: existing.revenue + (s.transPrice || 0) });
      }
      const topCats = Array.from(catMap.entries())
        .map(([category, data]) => ({ category, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const recommendations = [];

      for (const cat of topCats) {
        const bdmAvgPrice = cat.count > 0 ? Math.round(cat.revenue / cat.count) : 0;

        // Blend with state avg price if available
        const stateData = stateCatPrices.get(cat.category);
        const avgPrice = stateData
          ? Math.round(0.7 * bdmAvgPrice + 0.3 * stateData.avgPrice)
          : bdmAvgPrice;

        // ── C) New 80/20 scoring ──────────────────────────────────────
        const candidates = await storage.getStockCandidatePool(cat.category, 40);

        // Find max ageing days in pool for normalization
        const maxAge = candidates.reduce((m, c) => Math.max(m, c.ageingDays || 0), 1);

        const scored = candidates.map(item => {
          const stockTypeScore = stockTypeFreq.get(item.stockType || "") || 0;
          const ageScore = (item.ageingDays || 0) / maxAge;
          const finalScore = 0.8 * stockTypeScore + 0.2 * ageScore;

          const priceDiff = item.tagPrice && avgPrice > 0
            ? 1 - Math.abs((item.tagPrice - avgPrice) / avgPrice)
            : 0;

          return {
            item,
            score: Math.round(finalScore * 100) / 100,
            priceMatch: Math.max(0, Math.round(priceDiff * 100)) / 100,
          };
        });

        // Sort by finalScore desc, take top topK
        scored.sort((a, b) => b.score - a.score);
        const topScored = scored.slice(0, topK);

        const toSummary = (entry: typeof topScored[0]) => ({
          id: entry.item.id,
          jewelCode: entry.item.jewelCode,
          styleNo: entry.item.styleNo,
          imageUrl: proxyDriveUrl(entry.item.imageUrl),
          category: entry.item.category,
          tagPrice: entry.item.tagPrice,
          status: entry.item.status,
          grossWt: entry.item.grossWt,
          pureWt: entry.item.pureWt,
          collectionName: entry.item.collectionName,
          subCategory: entry.item.subCategory,
          priceMatch: entry.priceMatch,
          stockType: entry.item.stockType,
          ageingDays: entry.item.ageingDays,
          score: entry.score,
        });

        // ── Earring matching for set categories ──────────────────────
        const SET_TO_EARRING: Record<string, string> = {
          "CHOKAR SET": "CHOKAR SET EARRING",
          "NECKLACE SET": "NECKLACE SET EARRING",
          "LONG NECKLACE SET": "LONG NECKLACE SET EARRING",
          "CHAIN NECKLACE SET": "CHAIN NECKLACE SET EARRING",
          "PENDANT SET": "PENDANT SET EARRING",
          "LONG PENDANT SET": "LONG PENDANT SET EARRING",
        };

        let matchedEarring = null;
        const earringCat = SET_TO_EARRING[cat.category];
        if (earringCat && topScored.length > 0) {
          const earringItem = await storage.findMatchingEarring(topScored[0].item.styleNo, earringCat);
          if (earringItem) {
            matchedEarring = {
              id: earringItem.id,
              jewelCode: earringItem.jewelCode,
              styleNo: earringItem.styleNo,
              imageUrl: proxyDriveUrl(earringItem.imageUrl),
              category: earringItem.category,
              tagPrice: earringItem.tagPrice,
              status: earringItem.status,
              grossWt: earringItem.grossWt,
              pureWt: earringItem.pureWt,
              collectionName: earringItem.collectionName,
              subCategory: earringItem.subCategory,
              priceMatch: 0,
              stockType: earringItem.stockType,
              ageingDays: earringItem.ageingDays,
              score: 0,
            };
          }
        }

        if (topScored.length > 0) {
          recommendations.push({
            category: cat.category,
            salesCount: cat.count,
            avgPrice,
            totalOnHand: candidates.length,
            suggested: toSummary(topScored[0]),
            alternatives: topScored.slice(1).map(toSummary),
            matchedEarring,
          });
        } else {
          recommendations.push({
            category: cat.category,
            salesCount: cat.count,
            avgPrice,
            totalOnHand: 0,
            suggested: null,
            alternatives: [],
            matchedEarring: null,
          });
        }
      }

      // Build profile summary
      const totalRevenue = sales.reduce((s, r) => s + (r.transPrice || 0), 0);
      const profile = {
        bdmName,
        totalSales: sales.length,
        totalRevenue,
        topCategories: topCats,
        avgStockAge,
        stockTypeBreakdown,
      };

      res.json({ bdmName, recommendations, profile });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Google Drive image proxy (avoids CORP / redirect issues) ────────────
  app.get("/api/drive-image/:fileId", async (req, res) => {
    const { fileId } = req.params;
    if (!fileId || !/^[\w-]+$/.test(fileId)) {
      return res.status(400).json({ error: "Invalid file ID" });
    }
    try {
      const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=view`;
      const upstream = await fetch(url);
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: "Failed to fetch image" });
      }
      const ct = upstream.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=86400");
      const arrayBuf = await upstream.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
    } catch {
      res.status(502).json({ error: "Image proxy error" });
    }
  });

  // ── State list ─────────────────────────────────────────────────────────
  app.get("/api/assortment/state-list", async (_req, res) => {
    try {
      const states = await storage.getDistinctStates();
      res.json({ states });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── State summary ────────────────────────────────────────────────────
  app.get("/api/assortment/state-summary/:stateName", async (req, res) => {
    try {
      const { stateName } = req.params;
      const allSales = await db.select().from(b2cSalesTable)
        .where(sql`${b2cSalesTable.stateName} = ${stateName}`);

      const totalRevenue = allSales.reduce((s, r) => s + (r.transPrice || 0), 0);

      const catMap = new Map<string, { count: number; revenue: number }>();
      for (const s of allSales) {
        const cat = s.category || "Unknown";
        const existing = catMap.get(cat) || { count: 0, revenue: 0 };
        catMap.set(cat, { count: existing.count + 1, revenue: existing.revenue + (s.transPrice || 0) });
      }
      const topCategories = Array.from(catMap.entries())
        .map(([category, data]) => ({
          category,
          count: data.count,
          revenue: data.revenue,
          avgPrice: data.count > 0 ? Math.round(data.revenue / data.count) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      res.json({
        stateName,
        totalSales: allSales.length,
        totalRevenue,
        topCategories,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Save assortment plan ────────────────────────────────────────────────
  app.post("/api/assortment/save-plan", async (req, res) => {
    try {
      const { bdmName, selectedItemIds, notes } = req.body as {
        bdmName: string;
        selectedItemIds: string[];
        notes?: string;
      };
      if (!bdmName || !selectedItemIds?.length) {
        return res.status(400).json({ error: "bdmName and selectedItemIds are required" });
      }

      const plan = await storage.createAssortmentPlan({ bdmName, selectedItemIds, notes: notes || null });
      res.json(plan);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // -- Feedback API -----------------------------------------------------------

  app.post("/api/feedback", async (req, res) => {
    try {
      const parsed = insertDesignFeedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid feedback data", details: parsed.error.errors });
      }

      const feedback = await storage.createFeedback(parsed.data);

      // Generate and store embedding (non-blocking for the response)
      try {
        const embedding = await generateTextEmbedding(feedback.feedbackText);
        await addFeedbackVector(feedback.id, embedding, feedback.category, feedback.theme);
      } catch (embedError) {
        console.error("[feedback] Embedding failed for feedback", feedback.id, embedError);
        Sentry.captureException(embedError);
      }

      res.status(201).json(feedback);
    } catch (error: unknown) {
      Sentry.captureException(error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/feedback", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const category = req.query.category as string | undefined;
      const theme = req.query.theme as string | undefined;

      const [data, total] = await Promise.all([
        storage.getAllFeedback(page, limit, category, theme),
        storage.countFeedback(category, theme),
      ]);

      res.json({ data, total, page, limit });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/feedback/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const feedback = await storage.getFeedback(id);
      if (!feedback) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json(feedback);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.put("/api/feedback/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getFeedback(id);
      if (!existing) {
        return res.status(404).json({ error: "Feedback not found" });
      }

      const { feedbackText, tags, sentiment } = req.body;
      const updateData: Record<string, unknown> = {};
      if (feedbackText !== undefined) updateData.feedbackText = feedbackText;
      if (tags !== undefined) updateData.tags = tags;
      if (sentiment !== undefined) {
        if (sentiment !== "positive" && sentiment !== "corrective") {
          return res.status(400).json({ error: "sentiment must be 'positive' or 'corrective'" });
        }
        updateData.sentiment = sentiment;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const updated = await storage.updateFeedback(id, updateData as Partial<DesignFeedback>);

      // Re-embed only if feedbackText actually changed
      if (feedbackText && feedbackText !== existing.feedbackText) {
        try {
          const embedding = await generateTextEmbedding(feedbackText);
          await updateFeedbackVector(id, embedding);
        } catch (embedError) {
          console.error("[feedback] Re-embedding failed for feedback", id, embedError);
          Sentry.captureException(embedError);
        }
      }

      res.json(updated);
    } catch (error: unknown) {
      Sentry.captureException(error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.delete("/api/feedback/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getFeedback(id);
      if (!existing) {
        return res.status(404).json({ error: "Feedback not found" });
      }

      await storage.deleteFeedback(id);
      res.json({ success: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Live Stock Items API (synced from external API) ─────────────────────

  // GET /api/stock-items - list with filters and pagination
  app.get("/api/stock-items", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
      const status = req.query.status as string | undefined;
      const category = req.query.category as string | undefined;
      const location = req.query.location as string | undefined;
      const stockType = req.query.stockType as string | undefined;
      const search = req.query.search as string | undefined;
      const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined;
      const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined;
      const ageingTag = req.query.ageingTag as string | undefined;
      const sortBy = (req.query.sortBy as string) || "ageingDays";
      const sortDir = (req.query.sortDir as string) === "asc" ? "ASC" : "DESC";

      // Build dynamic WHERE using Drizzle sql fragments
      const fragments: ReturnType<typeof sql>[] = [];

      if (status) {
        fragments.push(sql`${liveStockItems.currentStatus} = ${status}`);
      }
      if (category) {
        fragments.push(sql`${liveStockItems.category} = ${category}`);
      }
      if (location) {
        fragments.push(sql`${liveStockItems.location} = ${location}`);
      }
      if (stockType) {
        fragments.push(sql`${liveStockItems.stockType} = ${stockType}`);
      }
      if (search) {
        const pattern = `%${search}%`;
        fragments.push(sql`(${liveStockItems.jewelCode} ILIKE ${pattern} OR ${liveStockItems.styleNo} ILIKE ${pattern})`);
      }
      if (minPrice !== undefined) {
        fragments.push(sql`${liveStockItems.tagPrice} >= ${minPrice}`);
      }
      if (maxPrice !== undefined) {
        fragments.push(sql`${liveStockItems.tagPrice} <= ${maxPrice}`);
      }
      if (ageingTag) {
        switch (ageingTag) {
          case "Fresh":
            fragments.push(sql`${liveStockItems.ageingDays} >= 0 AND ${liveStockItems.ageingDays} <= 30`);
            break;
          case "Active":
            fragments.push(sql`${liveStockItems.ageingDays} >= 31 AND ${liveStockItems.ageingDays} <= 60`);
            break;
          case "Moderate":
            fragments.push(sql`${liveStockItems.ageingDays} >= 61 AND ${liveStockItems.ageingDays} <= 90`);
            break;
          case "Slow Moving":
            fragments.push(sql`${liveStockItems.ageingDays} >= 91 AND ${liveStockItems.ageingDays} <= 180`);
            break;
          case "Ageing":
            fragments.push(sql`${liveStockItems.ageingDays} >= 181 AND ${liveStockItems.ageingDays} <= 270`);
            break;
          case "Non-Moving":
            fragments.push(sql`${liveStockItems.ageingDays} > 270`);
            break;
        }
      }

      // Combine conditions
      const whereCondition = fragments.length > 0
        ? sql.join(fragments, sql` AND `)
        : sql`1=1`;

      // Validate sortBy column — map to safe SQL identifiers
      const allowedSortColumns: Record<string, string> = {
        ageingDays: "ageing_days",
        tagPrice: "tag_price",
        costPrice: "cost_price",
        jewelCode: "jewel_code",
      };
      const sortColumnName = allowedSortColumns[sortBy] || "ageing_days";
      const orderExpr = sql.raw(`${sortColumnName} ${sortDir}`);

      const offset = (page - 1) * limit;

      const [countResult, dataResult] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)::int` })
          .from(liveStockItems)
          .where(whereCondition),
        db.select()
          .from(liveStockItems)
          .where(whereCondition)
          .orderBy(orderExpr)
          .limit(limit)
          .offset(offset),
      ]);

      const total = countResult[0]?.count ?? 0;

      res.json({
        items: dataResult,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/stock-items/sync - trigger manual sync
  app.post("/api/stock-items/sync", async (_req, res) => {
    try {
      const { syncStockData } = await import("./stock-sync");
      const result = await syncStockData();
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/stock-items/summary - dashboard summary stats
  app.get("/api/stock-items/summary", async (_req, res) => {
    try {
      // All counts and values in one pass using raw SQL for performance
      const summaryResult = await db.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCount",
          COUNT(*) FILTER (WHERE current_status = 'On Hand')::int AS "onHandCount",
          COUNT(*) FILTER (WHERE current_status = 'Memo')::int AS "memoCount",
          COUNT(*) FILTER (WHERE current_status = 'Sold')::int AS "soldCount",
          COALESCE(SUM(cost_price) FILTER (WHERE current_status = 'On Hand'), 0)::bigint AS "onHandCostValue",
          COALESCE(SUM(tag_price) FILTER (WHERE current_status = 'On Hand'), 0)::bigint AS "onHandTagValue",
          COUNT(*) FILTER (WHERE ageing_days > 365 AND current_status = 'On Hand')::int AS "deadStockCount",
          COALESCE(SUM(cost_price) FILTER (WHERE ageing_days > 365 AND current_status = 'On Hand'), 0)::bigint AS "deadStockCostValue",
          COALESCE(SUM(CAST(pure_wt AS numeric)) FILTER (WHERE current_status = 'On Hand'), 0)::numeric AS "onHandPureWt"
        FROM live_stock_items
      `);

      const summary = summaryResult.rows[0] as {
        totalCount: number;
        onHandCount: number;
        memoCount: number;
        soldCount: number;
        onHandCostValue: string;
        onHandTagValue: string;
        deadStockCount: number;
        deadStockCostValue: string;
        onHandPureWt: string;
      };

      // Category breakdown (top 10 by count)
      const catResult = await db.execute(sql`
        SELECT
          COALESCE(category, 'Unknown') AS category,
          COUNT(*)::int AS count,
          COALESCE(SUM(cost_price), 0)::bigint AS "costValue",
          COALESCE(SUM(tag_price), 0)::bigint AS "tagValue"
        FROM live_stock_items
        WHERE current_status = 'On Hand'
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      `);

      // Location breakdown
      const locResult = await db.execute(sql`
        SELECT
          COALESCE(location, 'Unknown') AS location,
          COUNT(*)::int AS count,
          COALESCE(SUM(cost_price), 0)::bigint AS "costValue",
          COALESCE(SUM(tag_price), 0)::bigint AS "tagValue"
        FROM live_stock_items
        WHERE current_status = 'On Hand'
        GROUP BY location
        ORDER BY count DESC
      `);

      // Ageing distribution breakdown (On Hand only)
      const ageingResult = await db.execute(sql`
        SELECT
          CASE
            WHEN ageing_days <= 30 THEN 'Fresh'
            WHEN ageing_days <= 60 THEN 'Active'
            WHEN ageing_days <= 90 THEN 'Moderate'
            WHEN ageing_days <= 180 THEN 'Slow Moving'
            WHEN ageing_days <= 270 THEN 'Ageing'
            ELSE 'Non-Moving'
          END AS label,
          COUNT(*)::int AS count,
          COALESCE(SUM(tag_price), 0)::bigint AS "tagValue"
        FROM live_stock_items
        WHERE current_status = 'On Hand'
        GROUP BY label
        ORDER BY MIN(ageing_days)
      `);

      // Sales person breakdown (Memo items — gross weight + cost)
      const bdmResult = await db.execute(sql`
        SELECT
          COALESCE(memo_sales_person_name, 'Unassigned') AS "salesPerson",
          COUNT(*)::int AS count,
          COALESCE(SUM(CAST(NULLIF(TRIM(gross_wt), '') AS numeric)), 0)::numeric AS "grossWt",
          COALESCE(SUM(cost_price), 0)::bigint AS "costValue"
        FROM live_stock_items
        WHERE current_status = 'Memo'
        GROUP BY "salesPerson"
        ORDER BY "grossWt" DESC
      `);

      res.json({
        totalCount: summary.totalCount,
        onHandCount: summary.onHandCount,
        memoCount: summary.memoCount,
        soldCount: summary.soldCount,
        onHandCostValue: Number(summary.onHandCostValue),
        onHandTagValue: Number(summary.onHandTagValue),
        deadStockCount: summary.deadStockCount,
        deadStockCostValue: Number(summary.deadStockCostValue),
        onHandPureWt: Number(summary.onHandPureWt),
        categoryBreakdown: (catResult.rows as Array<{ category: string; count: number; costValue: string; tagValue: string }>).map(r => ({
          category: r.category,
          count: r.count,
          costValue: Number(r.costValue),
          tagValue: Number(r.tagValue),
        })),
        locationBreakdown: (locResult.rows as Array<{ location: string; count: number; costValue: string; tagValue: string }>).map(r => ({
          location: r.location,
          count: r.count,
          costValue: Number(r.costValue),
          tagValue: Number(r.tagValue),
        })),
        ageingBreakdown: (ageingResult.rows as Array<{ label: string; count: number; tagValue: string }>).map(r => ({
          label: r.label,
          count: r.count,
          tagValue: Number(r.tagValue),
        })),
        bdmBreakdown: (bdmResult.rows as Array<{ salesPerson: string; count: number; grossWt: string; costValue: string }>).map(r => ({
          salesPerson: r.salesPerson,
          count: r.count,
          grossWt: Number(r.grossWt),
          costValue: Number(r.costValue),
        })),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── SELF-IMPROVING IMAGE GENERATION ENDPOINTS ──────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  // GET /api/evaluations — list evaluations with optional filters
  app.get("/api/evaluations", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const model = (req.query.model as string) || undefined;
      const promptVersionId = (req.query.promptVersionId as string) || undefined;

      const [items, total] = await Promise.all([
        storage.getEvaluations(page, limit, model, promptVersionId),
        storage.countEvaluations(model, promptVersionId),
      ]);

      res.json({ items, total, page, limit });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/evaluations/summary — aggregate scores by dimension/model/time
  app.get("/api/evaluations/summary", async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT
          model_provider,
          COUNT(*)::int as total,
          ROUND(AVG(brand_compliance)::numeric, 2) as avg_brand_compliance,
          ROUND(AVG(view_angle)::numeric, 2) as avg_view_angle,
          ROUND(AVG(composition)::numeric, 2) as avg_composition,
          ROUND(AVG(motif_accuracy)::numeric, 2) as avg_motif_accuracy,
          ROUND(AVG(stone_rendering)::numeric, 2) as avg_stone_rendering,
          ROUND(AVG(gold_balance)::numeric, 2) as avg_gold_balance,
          ROUND(AVG(overall_quality)::numeric, 2) as avg_overall_quality
        FROM design_evaluations
        GROUP BY model_provider
        ORDER BY model_provider
      `);

      // Time series: daily averages over last 30 days
      const timeSeries = await db.execute(sql`
        SELECT
          DATE(evaluated_at) as date,
          model_provider,
          ROUND(AVG(overall_quality)::numeric, 2) as avg_quality,
          COUNT(*)::int as count
        FROM design_evaluations
        WHERE evaluated_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(evaluated_at), model_provider
        ORDER BY date
      `);

      res.json({
        byModel: result.rows,
        timeSeries: timeSeries.rows,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/evaluations/project/:id — evaluations for a specific design project
  app.get("/api/evaluations/project/:id", async (req, res) => {
    try {
      const items = await storage.getEvaluationsByProject(req.params.id);
      res.json({ items });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/evaluate-design/:id — manually trigger evaluation for a design project
  app.post("/api/evaluate-design/:id", async (req, res) => {
    try {
      const project = await storage.getDesignProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Design project not found" });

      const evalContext = {
        category: project.category,
        motifs: project.motifs || [],
        stones: project.stones || [],
        materialRatio: project.materialRatio,
        mode: "sketch" as const,
      };

      const { evaluateDesignQuality } = await import("./evaluator");
      const scores = await evaluateDesignQuality(project.generatedImageUrl || "", evalContext);
      if (!scores) return res.status(500).json({ error: "Evaluation returned no scores" });

      const evaluation = await storage.createEvaluation({
        designProjectId: project.id,
        modelProvider: "manual",
        imageUrl: project.generatedImageUrl || "",
        ...scores,
        promptVersionId: null,
      });

      res.json(evaluation);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/prompt-versions — list all prompt versions
  app.get("/api/prompt-versions", async (req, res) => {
    try {
      const scope = (req.query.scope as string) || undefined;
      const versions = await storage.getPromptVersions(scope);
      res.json({ items: versions });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/prompt-versions/:id/activate — activate a specific prompt version
  app.post("/api/prompt-versions/:id/activate", async (req, res) => {
    try {
      const version = (await storage.getPromptVersions()).find(v => v.id === req.params.id);
      if (!version) return res.status(404).json({ error: "Prompt version not found" });

      await activatePromptVersion(version.id, version.scope as PromptScope);
      res.json({ success: true, activated: version.id, scope: version.scope });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/optimization-runs — list optimization runs
  app.get("/api/optimization-runs", async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT * FROM optimization_runs ORDER BY started_at DESC LIMIT 50
      `);
      res.json({ items: result.rows });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/optimize-prompts — trigger prompt optimization run
  app.post("/api/optimize-prompts", async (req, res) => {
    try {
      const scope = (req.body?.scope || "brand_rules") as PromptScope;
      if (!["brand_rules", "cad_rules", "grok_preamble"].includes(scope)) {
        return res.status(400).json({ error: "Invalid scope" });
      }

      // Import dynamically to avoid circular deps at startup
      const { optimizePrompts } = await import("./prompt-optimizer");
      const result = await optimizePrompts(scope);
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Bulk import assortment images as references ────────────────────────────
  // Progress state for the background job
  let assortImportJob: { running: boolean; total: number; processed: number; success: number; failed: number; results: { styleCode: string; success: boolean; error?: string }[] } = {
    running: false, total: 0, processed: 0, success: 0, failed: 0, results: [],
  };

  // Helper: extract theme code from style code (e.g., FQBRP03802NLS → BRP)
  function extractThemeCode(styleCode: string): string | null {
    const themePatterns = ["BRU", "BRP", "BRC", "CLO", "WRO", "WRD", "SOP", "SOO", "SOD"];
    const upper = styleCode.toUpperCase();
    for (const tc of themePatterns) {
      if (upper.includes(tc)) return tc;
    }
    // Handle CLP → CLO, SOLP → SOP
    if (upper.includes("CLP")) return "CLO";
    if (upper.includes("SOLP")) return "SOP";
    return null;
  }

  // Helper: map theme code → product segment
  function themeToSegment(themeCode: string | null): string {
    if (!themeCode) return "Traditional";
    const map: Record<string, string> = {
      BRP: "Bridal", BRC: "Bridal", BRU: "Bridal",
      CLO: "Traditional", WRO: "Traditional", WRD: "Modern",
      SOP: "Exclusive - Grandeur", SOO: "Modern", SOD: "Modern",
    };
    return map[themeCode] || "Traditional";
  }

  // Helper: normalize assortment category to reference category
  function normalizeCategory(cat: string): string {
    const map: Record<string, string> = {
      "NECKLACE SET": "Necklace Set",
      "CHOKAR SET": "Choker Set",
      "CHOKER SET": "Choker Set",
      "LONG NECKLACE SET": "Long Necklace Set",
      "LONG NECKLACE": "Long Necklace",
      "NECKLACE": "Necklace",
      "CHOKAR": "Choker",
      "CHOKER": "Choker",
      "BANGLE": "Bangle",
      "PENDANT": "Pendant",
      "EARRING": "Earrings",
      "RING": "Ring",
      "BRACELET": "Bracelet",
    };
    return map[cat.toUpperCase()] || cat;
  }

  app.post("/api/import-assortment-references", async (req, res) => {
    if (assortImportJob.running) {
      return res.status(409).json({ error: "Import already in progress", progress: assortImportJob });
    }

    try {
      const itemsPath = path.resolve("assortment-items.json");
      const imagesDir = path.resolve("assortment-images");
      const raw = await fs.readFile(itemsPath, "utf-8");
      const items: { styleCode: string; category: string; price: string; ageing: string; filename: string }[] = JSON.parse(raw);

      assortImportJob = { running: true, total: items.length, processed: 0, success: 0, failed: 0, results: [] };

      // Return immediately — process in background
      res.json({ message: `Started importing ${items.length} assortment items as references`, total: items.length });

      // Background processing
      for (const item of items) {
        try {
          const srcPath = path.join(imagesDir, item.filename);
          const fileBuffer = await fs.readFile(srcPath);
          const base64Image = fileBuffer.toString("base64");

          // Copy to uploads/ with timestamp
          const ext = path.extname(item.filename) || ".jpg";
          const uploadFilename = `${Date.now()}-${item.styleCode}${ext}`;
          const uploadPath = path.join("uploads", uploadFilename);
          await fs.writeFile(uploadPath, fileBuffer);

          // Generate thumbnail
          const thumbFilename = `thumb_${uploadFilename}`;
          const thumbPath = path.join("uploads", thumbFilename);
          await sharp(fileBuffer)
            .resize(300, 300, { fit: "cover", position: "center" })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);

          // Gemini Vision analysis
          const analysis = await analyzeReferenceImage(base64Image);

          // Generate embedding
          const embedding = await generateImageEmbedding(base64Image);

          // Derive theme code and segment
          const themeCode = extractThemeCode(item.styleCode);
          const productSegment = themeToSegment(themeCode);
          const category = normalizeCategory(item.category);

          // Store in DB
          const referenceImage = await storage.createReferenceImage({
            filename: `${item.styleCode}${ext}`,
            filepath: uploadPath,
            thumbnailPath: thumbPath,
            themeCode,
            productSegment,
            category,
            metadata: {
              ...analysis,
              styleCode: item.styleCode,
              tagPrice: item.price,
              ageingDays: item.ageing,
              source: "assortment-import",
            },
            embedding: embedding as unknown as Record<string, unknown>,
          });

          // Add to vector store
          await addVector(referenceImage.id, embedding, {
            ...analysis,
            themeCode,
            productSegment,
            category,
            styleCode: item.styleCode,
          });

          assortImportJob.success++;
          assortImportJob.results.push({ styleCode: item.styleCode, success: true });
          console.log(`[assort-import] ✓ ${assortImportJob.processed + 1}/${items.length} ${item.styleCode} → ${category} (${themeCode || "?"})`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          assortImportJob.failed++;
          assortImportJob.results.push({ styleCode: item.styleCode, success: false, error: msg });
          console.error(`[assort-import] ✗ ${item.styleCode}: ${msg}`);
        }
        assortImportJob.processed++;
      }

      assortImportJob.running = false;
      console.log(`[assort-import] Done: ${assortImportJob.success} ok, ${assortImportJob.failed} failed out of ${items.length}`);
    } catch (error: unknown) {
      assortImportJob.running = false;
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[assort-import] Fatal error:", msg);
      if (!res.headersSent) res.status(500).json({ error: msg });
    }
  });

  // Check progress of assortment import
  app.get("/api/import-assortment-references/status", (_req, res) => {
    res.json(assortImportJob);
  });

  // Retry failed assortment imports with delay between each to avoid rate limits
  // Accepts optional body: { styleCodes: string[] } to retry specific items
  app.post("/api/import-assortment-references/retry", async (req, res) => {
    if (assortImportJob.running) {
      return res.status(409).json({ error: "Import already in progress" });
    }

    // Accept explicit list from body, or fall back to in-memory failures
    const explicitCodes: string[] | undefined = req.body?.styleCodes;
    const failedCodes = explicitCodes?.length
      ? explicitCodes
      : assortImportJob.results.filter(r => !r.success).map(r => r.styleCode);
    if (failedCodes.length === 0) {
      return res.json({ message: "No failed items to retry" });
    }

    try {
      const itemsPath = path.resolve("assortment-items.json");
      const imagesDir = path.resolve("assortment-images");
      const raw = await fs.readFile(itemsPath, "utf-8");
      const allItems: { styleCode: string; category: string; price: string; ageing: string; filename: string }[] = JSON.parse(raw);
      const retryItems = allItems.filter(i => failedCodes.includes(i.styleCode));

      assortImportJob = { running: true, total: retryItems.length, processed: 0, success: 0, failed: 0, results: [] };
      res.json({ message: `Retrying ${retryItems.length} failed items with 3s delay between each`, total: retryItems.length });

      for (const item of retryItems) {
        // 15s delay between items to avoid Gemini rate limits
        await new Promise(resolve => setTimeout(resolve, 15000));

        // Inner retry: up to 3 attempts with exponential backoff for 503 errors
        let succeeded = false;
        for (let attempt = 1; attempt <= 3 && !succeeded; attempt++) {
          try {
            const srcPath = path.join(imagesDir, item.filename);
            const fileBuffer = await fs.readFile(srcPath);
            const base64Image = fileBuffer.toString("base64");
            const ext = path.extname(item.filename) || ".jpg";
            const uploadFilename = `${Date.now()}-${item.styleCode}${ext}`;
            const uploadPath = path.join("uploads", uploadFilename);
            await fs.writeFile(uploadPath, fileBuffer);
            const thumbFilename = `thumb_${uploadFilename}`;
            const thumbPath = path.join("uploads", thumbFilename);
            await sharp(fileBuffer).resize(300, 300, { fit: "cover", position: "center" }).jpeg({ quality: 80 }).toFile(thumbPath);
            const analysis = await analyzeReferenceImage(base64Image);
            const embedding = await generateImageEmbedding(base64Image);
            const themeCode = extractThemeCode(item.styleCode);
            const productSegment = themeToSegment(themeCode);
            const category = normalizeCategory(item.category);
            const referenceImage = await storage.createReferenceImage({
              filename: `${item.styleCode}${ext}`,
              filepath: uploadPath, thumbnailPath: thumbPath, themeCode, productSegment, category,
              metadata: { ...analysis, styleCode: item.styleCode, tagPrice: item.price, ageingDays: item.ageing, source: "assortment-import" },
              embedding: embedding as unknown as Record<string, unknown>,
            });
            await addVector(referenceImage.id, embedding, { ...analysis, themeCode, productSegment, category, styleCode: item.styleCode });
            assortImportJob.success++;
            assortImportJob.results.push({ styleCode: item.styleCode, success: true });
            console.log(`[assort-retry] ✓ ${assortImportJob.processed + 1}/${retryItems.length} ${item.styleCode} (attempt ${attempt})`);
            succeeded = true;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand");
            if (is503 && attempt < 3) {
              const backoff = attempt * 20000; // 20s, 40s
              console.warn(`[assort-retry] ${item.styleCode} attempt ${attempt} got 503, waiting ${backoff/1000}s...`);
              await new Promise(resolve => setTimeout(resolve, backoff));
            } else {
              assortImportJob.failed++;
              assortImportJob.results.push({ styleCode: item.styleCode, success: false, error: msg });
              console.error(`[assort-retry] ✗ ${item.styleCode} (attempt ${attempt}): ${msg}`);
            }
          }
        }
        assortImportJob.processed++;
      }
      assortImportJob.running = false;
      console.log(`[assort-retry] Done: ${assortImportJob.success} ok, ${assortImportJob.failed} failed`);
    } catch (error: unknown) {
      assortImportJob.running = false;
      const msg = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) res.status(500).json({ error: msg });
    }
  });

  // GET /api/stock-items/last-sync - when was last sync
  app.get("/api/stock-items/last-sync", async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT synced_at FROM live_stock_items ORDER BY synced_at DESC LIMIT 1
      `);
      const row = result.rows[0] as { synced_at: string } | undefined;
      res.json({ lastSync: row?.synced_at || null });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── B2B Sales History endpoints ────────────────────────────────────────

  app.get("/api/b2b-sales/bdm-list", async (_req, res) => {
    try {
      const bdms = await storage.getDistinctB2bBdmNames();
      res.json({ bdms });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/b2b-sales/bdm/:name/states", async (req, res) => {
    try {
      const states = await storage.getB2bStatesForBdm(req.params.name);
      res.json({ states });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/b2b-sales/bdm/:name/clients", async (req, res) => {
    try {
      const stateName = req.query.state ? String(req.query.state) : undefined;
      console.log(`[clients] bdm=${req.params.name} state=${stateName || "(all)"}`);
      const clients = await storage.getB2bClientsForBdm(req.params.name, stateName);
      res.json({ clients });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  // ── Exhibition Assortment Endpoints ────────────────────────────────────

  app.get("/api/assortment/exhibition-list", async (_req, res) => {
    try {
      const exhibitions = await storage.getExhibitionList();
      res.json({ exhibitions });
    } catch (error: unknown) {
      console.error("[exhibition-list] Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/assortment/exhibition-signals", async (req, res) => {
    try {
      const exhibition = (req.query.exhibition as string) || "all";
      const signals = await storage.getExhibitionSignals(exhibition === "all" ? undefined : exhibition);
      res.json({ signals });
    } catch (error: unknown) {
      console.error("[exhibition-signals] Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/assortment/exhibition-score", async (req, res) => {
    try {
      const { exhibition, kitSize = 100 } = req.body;
      console.log(`[exhibition-score] Starting for exhibition: ${exhibition || "all"}, kitSize: ${kitSize}`);

      const signals = await storage.getExhibitionSignals(
        exhibition && exhibition !== "all" ? exhibition : undefined
      );

      const { scoreExhibitionAssortment } = await import("./assortment-scorer");
      const result = await scoreExhibitionAssortment(signals, kitSize);

      // Map to frontend shape matching AiScoredItem
      const responseItems = result.items.map(item => {
        const ageTag = item.ageingDays <= 30 ? "Fresh" : item.ageingDays <= 60 ? "Active" : item.ageingDays <= 90 ? "Moderate" : item.ageingDays <= 180 ? "Slow Moving" : item.ageingDays <= 270 ? "Ageing" : "Non-Moving";
        return {
          jewelCode: item.jewelCode,
          styleNo: item.styleNo,
          category: item.category,
          tagPrice: item.tagPrice,
          costPrice: item.costPrice,
          ageingDays: item.ageingDays,
          ageTag,
          grossWt: item.grossWt,
          pureWt: item.pureWt,
          totDiaWt: item.totDiaWt,
          baseMetal: item.baseMetal,
          stockType: item.stockType,
          location: item.location,
          imageUrl: item.imageUrl,
          score: Math.min(100, Math.round(item.score * 10)), // scale to 0-100, capped
          tier: item.matchType === "strong" ? "STRONG MATCH" : item.matchType === "good" ? "GOOD MATCH" : "POSSIBLE",
          matchType: item.matchType,
          reasons: item.reasons,
          scoreBreakdown: { visual: 0, category: 0, price: 0, ageing: 0, uniqueness: 0 },
        };
      });

      res.json({
        items: responseItems,
        signalCount: result.signalCount,
        exhibition: exhibition || "all",
      });
    } catch (error: unknown) {
      console.error("[exhibition-score] Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/assortment/locations", async (_req, res) => {
    try {
      const locations = await storage.getDistinctLocations();
      res.json({ locations });
    } catch (error: unknown) {
      console.error("[locations] Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/assortment/location-score", async (req, res) => {
    try {
      const { destination, kitSize = 100 } = req.body;
      console.log(`[location-score] Scoring for destination: ${destination || "all"}, kitSize: ${kitSize}`);

      // Fetch on-hand items NOT at the destination (items to dispatch there)
      let whereExtra = "";
      if (destination) {
        whereExtra = ` AND UPPER(location) NOT LIKE '%${destination.toUpperCase().replace(/'/g, "''")}%'`;
      }
      const candidateResult = await db.execute(sql.raw(`
        SELECT jewel_code, style_no, category, tag_price, cost_price,
               ageing_days, gross_wt, pure_wt, tot_dia_wt, stock_type,
               location, image_url, base_metal, current_status
        FROM live_stock_items
        WHERE current_status = 'On Hand'${whereExtra}
        ORDER BY tag_price DESC
        LIMIT ${kitSize * 3}
      `));

      const rows = candidateResult.rows as Record<string, unknown>[];
      const responseItems = rows.map(row => {
        const ageingDays = Number(row.ageing_days) || 0;
        const tagPrice = Number(row.tag_price) || 0;
        // Score: ageing urgency (older = higher) + price normalization
        const ageScore = ageingDays > 270 ? 30 : ageingDays > 180 ? 25 : ageingDays > 90 ? 20 : ageingDays > 60 ? 15 : 10;
        const priceScore = Math.min(30, Math.round((tagPrice / 1000000) * 10));
        const score = Math.min(100, ageScore + priceScore + 30); // base 30 + ageing + price
        const ageTag = ageingDays <= 30 ? "Fresh" : ageingDays <= 60 ? "Active" : ageingDays <= 90 ? "Moderate" : ageingDays <= 180 ? "Slow Moving" : ageingDays <= 270 ? "Ageing" : "Non-Moving";
        const reasons = [];
        if (ageingDays > 90) reasons.push({ tag: "slow", text: `${ageingDays} days aged \u2014 priority dispatch` });
        if (tagPrice > 500000) reasons.push({ tag: "band", text: `High value item: \u20B9${(tagPrice/100000).toFixed(1)}L` });
        reasons.push({ tag: "new", text: `Available at ${row.location || "main store"}` });

        return {
          jewelCode: String(row.jewel_code || ""),
          styleNo: String(row.style_no || ""),
          category: String(row.category || ""),
          tagPrice,
          costPrice: Number(row.cost_price) || 0,
          ageingDays,
          ageTag,
          grossWt: String(row.gross_wt || "0"),
          pureWt: String(row.pure_wt || "0"),
          totDiaWt: String(row.tot_dia_wt || "0"),
          baseMetal: String(row.base_metal || ""),
          stockType: String(row.stock_type || ""),
          location: String(row.location || ""),
          imageUrl: String(row.image_url || ""),
          score,
          tier: score >= 80 ? "MUST INCLUDE" : score >= 60 ? "RECOMMENDED" : "OPTIONAL",
          reasons,
          scoreBreakdown: { visual: 0, category: 0, price: 0, ageing: 0, uniqueness: 0 },
        };
      });

      responseItems.sort((a, b) => b.score - a.score);

      res.json({
        items: responseItems.slice(0, kitSize * 3),
        profile: null,
        timing: { totalMs: 0, method: "formula" as const },
      });
    } catch (error: unknown) {
      console.error("[location-score] Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── AI Assortment Scoring (vector-based) ─────────────────────────────────

  app.post("/api/assortment/ai-score", async (req, res) => {
    try {
      const { bdmName, stateName, clientName, kitSize = 100, weightMin, weightMax, weights } = req.body;
      if (!bdmName) {
        return res.status(400).json({ error: "bdmName is required" });
      }

      console.log(`[ai-score] Starting vector scoring for BDM: ${bdmName}, state: ${stateName || "all"}, client: ${clientName || "all"}`);

      // Fetch BDM's past sales (metadata for profile generation)
      const sales = await storage.getB2bSalesByBdm(bdmName, stateName || undefined, clientName || undefined);
      console.log(`[ai-score] Found ${sales.length} past sales`);

      // Fallback candidates for formula scoring (when no vectors available)
      let fallbackCandidates: Array<{ jewelCode: string; styleNo: string; category: string; tagPrice: number; costPrice: number; ageingDays: number; grossWt: string; pureWt: string; totDiaWt: string; stockType: string; location: string; imageUrl: string; baseMetal: string; currentStatus: string }> = [];

      // Check if we have embedded stock (for vector path)
      const embeddedCount = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM live_stock_items
        WHERE embedding_vector IS NOT NULL AND embedding_status = 'done'
      `);
      const hasEmbeddings = Number((embeddedCount.rows[0] as { cnt: string }).cnt) > 0;

      if (!hasEmbeddings) {
        // No embeddings yet — fetch raw candidates for formula fallback
        console.log("[ai-score] No stock embeddings found, using formula fallback");
        let candidateQuery = `
          SELECT jewel_code, style_no, category, tag_price, cost_price,
                 ageing_days, gross_wt, pure_wt, tot_dia_wt, stock_type, location,
                 image_url, base_metal, current_status
          FROM live_stock_items
          WHERE current_status = 'On Hand'
        `;
        if (weightMin) candidateQuery += ` AND CAST(NULLIF(TRIM(gross_wt), '') AS NUMERIC) >= ${Number(weightMin)}`;
        if (weightMax) candidateQuery += ` AND CAST(NULLIF(TRIM(gross_wt), '') AS NUMERIC) <= ${Number(weightMax)}`;
        candidateQuery += ` ORDER BY tag_price DESC LIMIT 300`;

        const candidateResult = await db.execute(sql.raw(candidateQuery));
        fallbackCandidates = (candidateResult.rows as Record<string, unknown>[]).map(row => ({
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
        }));
      }

      // Run scoring (vector path if embeddings exist, formula fallback otherwise)
      const { scoreAssortment } = await import("./assortment-scorer");
      const result = await scoreAssortment(
        sales, fallbackCandidates, bdmName, stateName, clientName,
        kitSize, weightMin, weightMax, weights
      );

      // Build category→top client map from BDM's sales (for per-card client labels)
      const catClientMap = new Map<string, string>();
      if (!clientName && sales.length > 0) {
        const catClientCount = new Map<string, Map<string, number>>();
        for (const s of sales) {
          const cat = (s.categoryGroup || s.category || "").toUpperCase().trim();
          const cli = (s.clientName || "").trim();
          if (!cat || !cli) continue;
          if (!catClientCount.has(cat)) catClientCount.set(cat, new Map());
          const m = catClientCount.get(cat)!;
          m.set(cli, (m.get(cli) || 0) + 1);
        }
        for (const [cat, clients] of Array.from(catClientCount.entries())) {
          let topClient = "";
          let topCount = 0;
          for (const [cli, cnt] of Array.from(clients.entries())) {
            if (cnt > topCount) { topClient = cli; topCount = cnt; }
          }
          if (topClient) catClientMap.set(cat, topClient);
        }
      }

      // Map to frontend shape
      const responseItems = result.items.slice(0, kitSize * 3).map(item => {
        const c = item.inventoryData;
        const tier = item.total >= 65 ? "MUST INCLUDE" : item.total >= 40 ? "RECOMMENDED" : item.total >= 20 ? "OPTIONAL" : null;
        const ageTag = c.ageingDays <= 30 ? "Fresh" : c.ageingDays <= 60 ? "Active" : c.ageingDays <= 90 ? "Moderate" : c.ageingDays <= 180 ? "Slow Moving" : c.ageingDays <= 270 ? "Ageing" : "Non-Moving";
        // Target client: explicit selection > category-based match (exact then fuzzy) > top overall
        const catKey = (c.category || "").toUpperCase().trim();
        let suggestedClient = clientName || catClientMap.get(catKey) || "";
        if (!suggestedClient && catKey) {
          // Fuzzy: find sales category that the stock category contains or vice versa
          for (const [salesCat, cli] of Array.from(catClientMap.entries())) {
            if (catKey.includes(salesCat) || salesCat.includes(catKey)) {
              suggestedClient = cli;
              break;
            }
          }
        }
        if (!suggestedClient && catClientMap.size > 0) {
          suggestedClient = Array.from(catClientMap.values())[0];
        }
        return {
          jewelCode: c.jewelCode,
          styleNo: c.styleNo,
          category: c.category,
          tagPrice: c.tagPrice,
          costPrice: c.costPrice,
          ageingDays: c.ageingDays,
          ageTag,
          grossWt: c.grossWt,
          pureWt: c.pureWt,
          totDiaWt: c.totDiaWt,
          baseMetal: c.baseMetal,
          stockType: c.stockType,
          location: c.location,
          imageUrl: c.imageUrl,
          score: item.total,
          tier,
          reasons: item.reasons,
          scoreBreakdown: item.breakdown,
          targetClient: suggestedClient,
        };
      });

      res.json({
        items: responseItems,
        profile: result.profile,
        timing: result.timing,
      });
    } catch (error: unknown) {
      console.error("[ai-score] Error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  return httpServer;
}
