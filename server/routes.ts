import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { referenceImages, b2cSales as b2cSalesTable } from "@shared/schema";
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
import { extractFolderId, listImagesInFolder, downloadImage } from "./google-drive";
import { searchSimilarStockItems } from "./stock-vector-store";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";

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

      const [geminiResult, openaiResult, grokResult] = await (async () => {
        if (mode === "cad") {
          // CAD mode: JSON spec prefixed with CAD_RULES (polki size is inside the JSON spec)
          const cadPrompt = buildCADPromptJSON(context, extras);
          console.log(`[generate-design] CAD PROMPT (${cadPrompt.length} chars):\n${"═".repeat(80)}\n${cadPrompt}\n${"═".repeat(80)}`);
          return Promise.allSettled([
            timedGenerate("Gemini", () => generateJewellerySketch(cadPrompt)),
            timedGenerate("OpenAI", () => generateCADImageWithOpenAI(cadPrompt, cadSize)),
            timedGenerate("Grok", () => generateImageWithGrok(cadPrompt, grokAspect)),
          ]);
        } else {
          // Sketch mode: JSON spec prefixed with BRAND_RULES (polki size is inside the JSON spec)
          const fullPrompt = `${BRAND_RULES}\n\n${imagePrompt}`;
          // Grok: use condensed preamble instead of full BRAND_RULES (8000-char limit)
          const grokPrompt = `${GROK_SKETCH_PREAMBLE}\n\n${imagePrompt}`;
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

  // Import images from Google Drive folder
  app.post("/api/import-from-drive", async (req, res) => {
    try {
      // Validate request body
      const parseResult = driveImportRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors[0]?.message || "Invalid request" });
      }
      
      const { folderUrl, themeCode } = parseResult.data;

      // Extract folder ID from URL
      const folderId = extractFolderId(folderUrl);

      // List images in folder
      const files = await listImagesInFolder(folderId);
      
      if (files.length === 0) {
        return res.status(400).json({ error: "No images found in the folder" });
      }

      const results: { filename: string; success: boolean; error?: string }[] = [];
      let processed = 0;

      // Process each image
      for (const file of files) {
        try {
          // Download image from Drive
          const imageBuffer = await downloadImage(file.id);
          const base64Image = imageBuffer.toString('base64');

          // Analyze the image using Gemini Vision
          const analysis = await analyzeReferenceImage(base64Image);

          // Generate multimodal embedding for similarity search (using image directly)
          const embedding = await generateImageEmbedding(base64Image);

          // Save to uploads folder
          const uploadPath = `uploads/${Date.now()}_${file.name}`;
          await fs.writeFile(uploadPath, imageBuffer);

          // Generate thumbnail
          const thumbnailFilename = `thumb_${path.basename(uploadPath)}`;
          const thumbnailPath = path.join('uploads', thumbnailFilename);
          await sharp(imageBuffer)
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);

          // Store in database
          const referenceImage = await storage.createReferenceImage({
            filename: file.name,
            filepath: uploadPath,
            thumbnailPath: thumbnailPath,
            metadata: analysis,
            embedding: embedding as any,
            themeCode: themeCode,
          });

          // Add to vector store for similarity search (include themeCode in metadata)
          await addVector(referenceImage.id, embedding, { ...analysis, themeCode });

          results.push({ filename: file.name, success: true });
        } catch (error: any) {
          console.error(`Error processing ${file.name}:`, error);
          results.push({ filename: file.name, success: false, error: error.message });
        }
        processed++;
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        total: files.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      console.error("Error importing from Drive:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Re-analyze and re-embed all reference images with enhanced style metadata
  app.post("/api/reembed-references", async (req, res) => {
    try {
      // Get all reference images
      const images = await storage.getAllReferenceImages();
      
      if (images.length === 0) {
        return res.json({ message: "No reference images to re-embed", total: 0, success: 0, failed: 0 });
      }

      // Clear existing vectors
      await clearVectorStore();

      const results: { id: string; filename: string; success: boolean; error?: string }[] = [];

      // Re-analyze and re-embed each image with enhanced style extraction
      for (const image of images) {
        try {
          // Read the image file
          const fileBuffer = await fs.readFile(image.filepath);
          const base64Image = fileBuffer.toString('base64');

          // Re-analyze image with enhanced style metadata extraction
          const analysis = await analyzeReferenceImage(base64Image);
          
          // Generate new embedding from the analysis description
          const embedding = await generateImageEmbedding(base64Image);

          // Merge new analysis into existing metadata to preserve any custom fields
          // Also ensure themeCode is set (from column or existing metadata)
          const existingMetadata = (image.metadata as Record<string, any>) || {};
          const themeCode = image.themeCode || existingMetadata.themeCode || null;
          const updatedMetadata = { 
            ...existingMetadata, // preserve any existing custom fields
            ...analysis, // add/update with new vision analysis
            themeCode // ensure themeCode is preserved
          };

          // Update the reference image metadata in database (including pgvector column)
          await db.update(referenceImages)
            .set({ 
              metadata: updatedMetadata,
              embedding: embedding as any,
              embeddingVector: embedding // pgvector column
            })
            .where(eq(referenceImages.id, image.id));

          results.push({ id: image.id, filename: image.filename, success: true });
        } catch (error: any) {
          console.error(`Error re-embedding ${image.filename}:`, error);
          results.push({ id: image.id, filename: image.filename, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        message: "Re-embedding complete with enhanced style metadata",
        total: images.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      console.error("Error re-embedding references:", error);
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
          stylePromise.then(style => modifyJewelleryImage(resolvedPath, editPrompt, style)),
          // OpenAI: style-aware redesign prompt
          stylePromise.then(style => {
            const openAIEditPrompt = `You are a professional jewellery redesign AI. TASK: Redesign this jewellery piece so the output looks CLEARLY DIFFERENT from the input — apply the specifications below visibly (new motifs, stones, layout as instructed).\n\n${buildStyleInstruction(style)}\n\n${editPrompt}`;
            return modifyImageWithOpenAI(resolvedPath, openAIEditPrompt);
          }),
          // Grok: style-aware variation prompt
          stylePromise.then(style => {
            const grokEditPrompt = `${buildStyleInstruction(style)}\n\nTASK: Apply the following design modifications to create a CLEARLY DIFFERENT variation of the uploaded jewellery. Do NOT copy the original — the output must reflect the new specifications.\n\n${editPrompt}`;
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

      // Generate both models in parallel — same prompt, different engines
      // OpenAI failure falls back to Gemini automatically (reuses already-generated Gemini image)
      // Compute aspect ratio based on category
      const cadIsPortrait = PORTRAIT_CATEGORIES.some(c =>
        resolvedCategory.toLowerCase().includes(c.toLowerCase())
      );
      const cadSize = cadIsPortrait ? "1024x1536" as const : "1024x1024" as const;

      const [geminiResult, openaiResult, grokResult] = await Promise.allSettled([
        generateJewellerySketch(cadPrompt),
        generateCADImageWithOpenAI(cadPrompt, cadSize),
        generateImageWithGrok(cadPrompt, cadIsPortrait ? "3:4" : "1:1"),
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

      // Run all 3 AI models in parallel — allSettled so one failure doesn't block the others
      const [geminiResult, openaiResult, grokResult] = await Promise.allSettled([
        generateMarketingVisualGemini(base64Image, prompt),
        generateMarketingVisualOpenAI(base64Image, prompt),
        generateMarketingVisualGrok(base64Image, prompt),
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

  return httpServer;
}
