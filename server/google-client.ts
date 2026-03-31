import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

// Lazily initialize Gemini client so it reads GEMINI_API_KEY after .env is loaded
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return _ai;
}

const GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || "";
const VERTEX_AI_LOCATION = "us-central1";

/** Retry once on transient Gemini errors (DEADLINE_EXCEEDED / UNAVAILABLE). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DEADLINE_EXCEEDED") || msg.includes("UNAVAILABLE") || msg.includes("503")) {
      console.warn("[Gemini] Transient error, retrying once:", msg);
      await new Promise(r => setTimeout(r, 3000));
      return fn();
    }
    throw err;
  }
}

export interface VisionAnalysisResult {
  description: string;
  styleElements: string[];
  motifs: string[];
  structure: string;
  lineStyle?: string;
  coloringTechnique?: string;
  labelStyle?: string;
  gemstoneRendering?: string;
  backgroundStyle?: string;
}

export interface DesignContext {
  category: string;
  theme: string;
  motifs: string[];
  stones: string[];
  materialRatio: string;
  customNotes?: string;
  similarDesigns?: VisionAnalysisResult[];
}

// Analyze reference image using Gemini Vision
export async function analyzeReferenceImage(
  base64Image: string,
): Promise<VisionAnalysisResult> {
  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: "image/jpeg",
              },
            },
            {
              text: `You are an expert jewellery design analyst. Analyze this jewellery design sketch image and extract detailed style information:

1. description: A detailed description of the design
2. styleElements: List of style elements (line weight, shading technique, rendering style)
3. motifs: Motifs present (nature, geometric, celestial, etc.)
4. structure: Structural elements (symmetry, layout, pendant style, layering)
5. lineStyle: Describe the line quality (e.g., "fine pencil lines in soft brown", "thin gold-toned outlines", "delicate hand-drawn strokes")
6. coloringTechnique: How colors are applied (e.g., "soft watercolor washes", "light colored pencil shading", "pastel fills")
7. labelStyle: If there are text labels, describe them (e.g., "cursive brown handwriting with thin pointing lines", "none")
8. gemstoneRendering: How gemstones are drawn (e.g., "polki as irregular white shapes with subtle facets", "rubies as soft pink ovals")
9. backgroundStyle: Background description (e.g., "pure white paper", "aged cream/beige paper", "vintage textured")

Respond in JSON format: { "description": string, "styleElements": string[], "motifs": string[], "structure": string, "lineStyle": string, "coloringTechnique": string, "labelStyle": string, "gemstoneRendering": string, "backgroundStyle": string }`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    // Extract text from response candidates
    let responseText = "";
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          responseText = part.text;
          break;
        }
      }
    }

    if (!responseText) {
      throw new Error("No text response from Gemini Vision");
    }

    const result = JSON.parse(responseText);
    return result as VisionAnalysisResult;
  } catch (error: any) {
    throw new Error(`Failed to analyze image with Gemini: ${error.message}`);
  }
}

// Generate text embedding using Gemini API (works with API key, no GCP auth needed)
// Using gemini-embedding-001 which produces 3072-dimension vectors (text-embedding-004 was deprecated Jan 14, 2026)
export async function generateTextEmbedding(text: string): Promise<number[]> {
  try {
    const response = await getAI().models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
    });

    if (
      response.embeddings &&
      response.embeddings.length > 0 &&
      response.embeddings[0].values
    ) {
      const embedding = response.embeddings[0].values;
      console.log(
        `Generated text embedding with ${embedding.length} dimensions`,
      );
      return embedding;
    }

    throw new Error("No embedding returned from Gemini");
  } catch (error: any) {
    throw new Error(`Failed to generate text embedding: ${error.message}`);
  }
}

// Generate image embedding by first analyzing the image, then embedding the description
export async function generateImageEmbedding(
  imageBase64: string,
): Promise<number[]> {
  try {
    // First analyze the image to get a rich text description
    const analysis = await analyzeReferenceImage(imageBase64);

    // Create a comprehensive text representation for embedding
    const embeddingText = `${analysis.description} Style: ${(analysis.styleElements || []).join(", ")}. Motifs: ${(analysis.motifs || []).join(", ")}. Structure: ${analysis.structure}`;

    // Generate embedding from the text description
    return generateTextEmbedding(embeddingText);
  } catch (error: any) {
    throw new Error(`Failed to generate image embedding: ${error.message}`);
  }
}

// Build context from design request and similar references (for sketch plan)
export function buildDesignContext(
  request: DesignContext,
  brandRules: string,
): string {
  let context = `${brandRules}\n\n`;

  context += `DESIGN REQUEST:\n`;
  context += `Category: ${request.category}\n`;
  context += `Theme: ${request.theme}\n`;
  context += `Motifs: ${request.motifs.join(", ")}\n`;
  context += `Material Ratio: ${request.materialRatio}\n`;

  if (request.customNotes) {
    context += `Custom Notes: ${request.customNotes}\n`;
  }

  if (request.similarDesigns && request.similarDesigns.length > 0) {
    context += `\nSIMILAR REFERENCE DESIGNS:\n`;
    request.similarDesigns.forEach((design, idx) => {
      context += `\nReference ${idx + 1}:\n`;
      context += `Description: ${design.description}\n`;
      context += `Style Elements: ${(design.styleElements || []).join(", ")}\n`;
      context += `Motifs: ${(design.motifs || []).join(", ")}\n`;
      context += `Structure: ${design.structure}\n`;
    });
  }

  return context;
}

// Build a comprehensive prompt for image generation with RAG-enhanced style transfer
export function buildImagePrompt(request: DesignContext): string {
  // Use exactly what the user selected for stones
  let stonesList = request.stones && request.stones.length > 0 ? [...request.stones] : ["Polki"];
  
  // Ensure Polki is always included (add if not present)
  if (!stonesList.map(s => s.toLowerCase()).includes("polki")) {
    stonesList.unshift("Polki");
  }
  
  // Determine if this is a pure Polki design (only Polki selected)
  const isPurePolki = stonesList.length === 1 && stonesList[0].toLowerCase() === "polki";

  // Extract detailed style information from similar designs in the reference library
  let styleDetails = {
    lineStyle: "fine pencil linework in soft brown/gold tones",
    coloringTechnique: "soft watercolor washes with light colored-pencil shading",
    labelStyle: "cursive brown handwriting with thin pointing lines",
    gemstoneRendering: isPurePolki 
      ? "ONLY polki stones - irregular white/off-white uncut diamonds inlaid in gold kundan bezels, NO colored gemstones"
      : "polki as irregular white/off-white shapes inlaid in gold kundan bezels (must cover 50%+ of gemstone areas), colored stones as soft watercolor fills in accent drops",
    backgroundStyle: "pure white paper"
  };
  
  // Override defaults with actual reference library style if available (but NOT for pure polki designs)
  if (request.similarDesigns && request.similarDesigns.length > 0 && !isPurePolki) {
    const refDesign = request.similarDesigns[0];
    if (refDesign.lineStyle) styleDetails.lineStyle = refDesign.lineStyle;
    if (refDesign.coloringTechnique) styleDetails.coloringTechnique = refDesign.coloringTechnique;
    if (refDesign.labelStyle) styleDetails.labelStyle = refDesign.labelStyle;
    if (refDesign.gemstoneRendering) styleDetails.gemstoneRendering = refDesign.gemstoneRendering;
    if (refDesign.backgroundStyle) styleDetails.backgroundStyle = refDesign.backgroundStyle;
  }
  
  // Build style inspiration from multiple references
  let motifInspiration = "";
  if (request.similarDesigns && request.similarDesigns.length > 0) {
    const refMotifs: string[] = [];
    request.similarDesigns.forEach((design) => {
      if (design.motifs && design.motifs.length > 0) {
        refMotifs.push(...design.motifs);
      }
    });
    if (refMotifs.length > 0) {
      const uniqueMotifs = Array.from(new Set(refMotifs)).slice(0, 5);
      motifInspiration = ` Reference designs feature: ${uniqueMotifs.join(", ")}.`;
    }
  }
  
  const motifsList = request.motifs.slice(0, 5);
  
  // Build layout and composition rules based on category
  const categoryLower = request.category.toLowerCase();
  const isNecklaceSet = categoryLower.includes("necklace set") || categoryLower.includes("necklace_set");
  const isSet = categoryLower.includes("set");
  
  // Lead with HARD CONSTRAINTS first (most important rules)
  let hardConstraints = `
===== MANDATORY CONSTRAINTS (MUST FOLLOW) =====
1. SAFE ZONE: Keep ALL elements at least 15% away from every edge. The design should occupy maximum 70% of the canvas, centered with generous whitespace margins. Do NOT let any part of the design touch or exit the frame. The canvas is portrait-oriented (3:4 ratio) — use the vertical space.
2. COMPLETE DESIGN: The ENTIRE jewellery piece must be fully visible - every hook, chain end, pendant bottom, earring tip must be completely shown. If any element approaches the edge, SHRINK the entire composition.
3. NO CROPPING: ZERO tolerance for cutoffs. Check: Is the necklace clasp visible at top? Are ALL earring hooks and drops complete? Is the pendant bottom fully shown? If ANY part would be cropped, make the design SMALLER.
4. GOLD MINIMIZATION (THE "INVISIBLE" RULE):
   - Gold must be strictly limited to the structural framework ONLY.
   - The "walls" of gold between Polki stones must be hairline-thin.
   - Every millimeter of the gold framework must be encrusted with Polki accents (stone size must match the designer-specified polki size — do NOT default to tiny accents if large polki have been requested).
   - Visual Goal: A continuous surface of Polki stones where the gold is merely a shimmering outline.
   - NO solid gold plates, NO thick bands, NO visible flat gold surfaces.
5. MANDATORY VIEW: Generate ONLY a flat front-view (straight-on, facing viewer). NEVER show side angles, 3/4 perspective, tilted views, or any rotation. The piece must appear as a flat technical elevation drawing viewed from directly in front.`;

  if (isNecklaceSet) {
    hardConstraints += `
6. EARRING COUNT: EXACTLY 2 EARRINGS TOTAL. NOT 3, NOT 4, ONLY 2.
   - ONE earring on the LEFT side of the necklace
   - ONE earring on the RIGHT side of the necklace
   - These are a MATCHING PAIR. Do NOT add extra earrings.
7. LAYOUT ANCHORING FOR NECKLACE SET:
   - TOP ZONE (10-20% from top): Necklace chain/clasp - must be FULLY visible
   - MIDDLE ZONE (25-75%): Main necklace body and pendant - centered
   - BOTTOM ZONE (75-90%): Pendant drops and earring bottoms - must be COMPLETE with space below
   - LEFT ZONE (10-30%): Left earring - fully visible from hook to bottom drop
   - RIGHT ZONE (70-90%): Right earring - fully visible from hook to bottom drop`;
  } else if (isSet) {
    hardConstraints += `
6. EARRING COUNT: If earrings are included, show EXACTLY 2 (one matching pair).
7. LAYOUT: Ensure ALL pieces are complete with generous margins. Every hook, drop, and pendant tip must be fully visible.`;
  } else {
    hardConstraints += `
6. LAYOUT: Center the piece with generous margins. Every edge of the jewellery must be fully visible with whitespace around it.`;
  }

  const prompt = `${hardConstraints}
===== END MANDATORY CONSTRAINTS =====

Create a FLAT FRONT-VIEW technical jewellery design sketch of a traditional Indian ${request.category}.

DESIGN ELEMENTS:
- Motifs: ${motifsList.join(", ")}
- Gemstones: ${stonesList.join(", ")}
${isPurePolki 
    ? `- PURE POLKI DESIGN: This design uses ONLY Polki stones (uncut diamonds). NO colored gemstones allowed - no rubies, emeralds, sapphires, or any other colored stones. 100% Polki inlaid in gold kundan-style bezels. The entire design should feature white/off-white polki stones set in gold.`
    : `- POLKI DOMINANCE RULE: Polki stones (uncut diamonds) must cover MORE THAN 50% of all gemstone areas. Polki MUST be inlaid into gold kundan-style bezels. Other gemstones (${stonesList.filter(s => s.toLowerCase() !== 'polki').join(', ')}) may appear as accent drops or border elements, but polki dominates the main structure.`}${motifInspiration}

VISUAL STYLE:
- View: STRICTLY flat orthographic front view — straight-on facing the viewer. NO side angle, NO 3/4 view, NO perspective, NO tilt. Imagine the piece pinned flat to a wall and viewed head-on.
- Background: Pure white (#FFFFFF), no texture, no shadows
- Lines: ${styleDetails.lineStyle}
- Coloring: ${styleDetails.coloringTechnique}
- Gemstones: ${styleDetails.gemstoneRendering}

DO NOT add any text labels, annotations, or handwriting to the design. Generate a CLEAN design without any labels.

NO signatures, watermarks, prices, or category text.

FINAL CHECK: The canvas is PORTRAIT (taller than wide). Before generating, verify: (1) the ENTIRE design fits within the center 70% of the canvas, (2) NO parts are cut off at ANY edge, (3) every earring hook, pendant drop, and chain end is fully visible with whitespace margins around the entire composition.${request.customNotes ? ` ${request.customNotes}` : ""}`;

  return prompt;
}

// Generate jewellery sketch using Gemini 3 Pro Image Preview (superior text rendering and reasoning)
export async function generateJewellerySketch(prompt: string): Promise<string> {
  try {
    // Use Gemini 3 Pro Image Preview for best text rendering and multi-turn reasoning
    const response = await withRetry(() => getAI().models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "1K",
        },
        httpOptions: {
          timeout: 180_000, // 3 minute timeout
        },
      },
    }));

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No response from Gemini 3 Pro Image");
    }

    const candidate = response.candidates[0];

    // Check if generation was blocked before checking for image data
    const finishReason = (candidate as any).finishReason;
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      const blockReason = (response as any).promptFeedback?.blockReason;
      const detail = blockReason ? `blocked: ${blockReason}` : `finish reason: ${finishReason}`;
      throw new Error(`Gemini generation stopped — ${detail}`);
    }

    if (!candidate.content || !candidate.content.parts) {
      throw new Error("No content in Gemini 3 Pro Image response");
    }

    // Find the image part in the response
    let imageData: Buffer | null = null;
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        imageData = Buffer.from(part.inlineData.data, "base64");
        break;
      }
    }

    if (!imageData) {
      throw new Error("No image data in Gemini 3 Pro Image response");
    }

    // Save the image to uploads directory and return the path
    const timestamp = Date.now();
    const filename = `generated_${timestamp}.png`;
    const filepath = path.join("uploads", filename);

    fs.writeFileSync(filepath, imageData);

    // Return the URL path that the frontend can access
    return `/uploads/${filename}`;
  } catch (error: any) {
    throw new Error(`Failed to generate image with Gemini 3 Pro: ${error.message}`);
  }
}

// Edit an existing jewellery sketch using Gemini image-to-image
export async function editJewellerySketch(
  sourceImagePath: string,
  editPrompt: string,
): Promise<string> {
  try {
    // Read the source image from disk
    const fullPath = sourceImagePath.startsWith("/uploads/")
      ? path.join(".", sourceImagePath)
      : sourceImagePath;

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Source image not found: ${fullPath}`);
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString("base64");

    // Build the edit prompt with style preservation
    const fullPrompt = `You are editing an existing jewellery design sketch. 

CRITICAL LAYOUT RULES:
- Keep ALL elements at least 12% away from every edge
- The ENTIRE design must be COMPLETE - no cropping, no cutoffs
- If any part would be cut off, SHRINK the entire composition to fit with margins

Keep the same artistic style: Traditional Indian jewellery design sketch on a clean white background, thin clean pencil outlines in soft brown. 

GOLD MINIMIZATION: Gold must be strictly limited to hairline-thin structural walls between stones. Every millimeter of gold should be encrusted with micro-Polki accents. Visual goal: A continuous Polki surface where gold is merely a shimmering outline. NO solid gold plates, thick bands, or flat gold surfaces. Colored gemstones appear only as small accent drops.

MANDATORY VIEW: Maintain a flat front-view (straight-on, facing the viewer). Do NOT rotate, tilt, or show any side/3/4 angle. The edited design must remain a flat technical front-facing view.

EDIT REQUEST: ${editPrompt}

Apply the requested changes while maintaining the overall design aesthetic and style. Ensure the edited design remains COMPLETE with generous margins - no elements touching or exiting the frame.`;

    // Use Gemini 3 Pro Image Preview with the source image and edit instructions
    const response = await withRetry(() => getAI().models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: "image/png",
              },
            },
            { text: fullPrompt },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "1K",
        },
        httpOptions: {
          timeout: 180_000, // 3 minute timeout
        },
      },
    }));

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No response candidates from Gemini");
    }

    const content = candidates[0].content;
    if (!content || !content.parts) {
      throw new Error("No content parts in Gemini response");
    }

    // Find the image part in the response
    for (const part of content.parts) {
      if (part.inlineData && part.inlineData.data) {
        const timestamp = Date.now();
        const filename = `edited_${timestamp}.png`;
        const filepath = path.join("uploads", filename);

        const imageData = Buffer.from(part.inlineData.data, "base64");
        fs.writeFileSync(filepath, imageData);

        return `/uploads/${filename}`;
      }
    }

    throw new Error("No image data in Gemini edit response");
  } catch (error: any) {
    throw new Error(`Failed to edit image with Gemini: ${error.message}`);
  }
}

// Modify a jewellery image while preserving its original visual style/medium
export async function modifyJewelleryImage(
  sourceImagePath: string,
  editPrompt: string,
  precomputedStyle?: string,
): Promise<string> {
  try {
    const fullPath = path.isAbsolute(sourceImagePath)
      ? sourceImagePath
      : sourceImagePath.startsWith("/uploads/")
        ? path.join(".", sourceImagePath)
        : sourceImagePath;

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Source image not found: ${fullPath}`);
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString("base64");

    // Use pre-computed style if provided to avoid a redundant Gemini Vision call
    const styleDescription = precomputedStyle ?? await analyzeImageStyle(fullPath);

    // Step 2: Build style-anchored modify prompt
    const fullPrompt = `You are editing an existing jewellery image.

ORIGINAL IMAGE STYLE (auto-detected):
"${styleDescription}"

CRITICAL REQUIREMENT: Your output MUST exactly match the original image's visual style described above.
- If the original is a product photograph → output must be a product photograph
- If the original is a hand-drawn sketch → output must remain a hand-drawn sketch
- If the original is a 3D CAD render → output must remain a 3D CAD render
- Do NOT convert to a different medium under any circumstances
- Preserve the background, lighting, material rendering, and overall look of the original

FORBIDDEN: sketches, line drawings, illustrations, pencil outlines, artistic rendering of any kind if the original is a photograph.

CRITICAL LAYOUT RULES:
- Keep ALL elements at least 12% away from every edge
- The ENTIRE design must be COMPLETE — no cropping, no cutoffs
- If any part would be cut off, SHRINK the entire composition to fit with margins

MANDATORY VIEW: Output must show the jewellery from a flat front-view (straight-on, facing the viewer). Do NOT rotate, tilt, or show any side/3/4 angle unless the original image was already at an angle.

MODIFICATION REQUEST:
${editPrompt}

Output must be visually indistinguishable in style from the original image.`;

    const response = await getAI().models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64Image, mimeType: "image/png" } },
            { text: fullPrompt },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "1K",
        },
        httpOptions: {
          timeout: 180_000, // 3 minute timeout
        },
      },
    });

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No response candidates from Gemini");
    }
    const content = candidates[0].content;
    if (!content || !content.parts) {
      throw new Error("No content parts in Gemini response");
    }

    for (const part of content.parts) {
      if (part.inlineData && part.inlineData.data) {
        const timestamp = Date.now();
        const filename = `modified_${timestamp}.png`;
        const filepath = path.join("uploads", filename);
        const imageData = Buffer.from(part.inlineData.data, "base64");
        fs.writeFileSync(filepath, imageData);
        return `/uploads/${filename}`;
      }
    }

    throw new Error("No image data in Gemini modify response");
  } catch (error: any) {
    throw new Error(`Failed to modify image with Gemini: ${error.message}`);
  }
}

// Analyze an image's visual style using Gemini Vision (text-only output)
export async function analyzeImageStyle(imagePath: string): Promise<string> {
  try {
    const fullPath = path.isAbsolute(imagePath)
      ? imagePath
      : imagePath.startsWith("/uploads/")
        ? path.join(".", imagePath)
        : imagePath;

    if (!fs.existsSync(fullPath)) {
      return "jewellery image";
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString("base64");
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
      : ext === ".webp" ? "image/webp"
      : "image/png";

    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64Image, mimeType } },
            {
              text: "Describe the visual style and rendering medium of this image in one focused sentence. Include: is it a photograph or illustration, the background surface/colour, lighting type, and how the materials (metal, stones) are rendered. Be specific and concise.",
            },
          ],
        },
      ],
      config: { httpOptions: { timeout: 30_000 } },
    });

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) return "jewellery image";
    const content = candidates[0].content;
    if (!content || !content.parts) return "jewellery image";

    for (const part of content.parts) {
      if (part.text) return part.text.trim();
    }

    return "jewellery image";
  } catch (error: any) {
    console.warn(`analyzeImageStyle failed, using fallback: ${error.message}`);
    return "jewellery image";
  }
}

// Build marketing visual prompt from parameters
export function buildMarketingPrompt(params: {
  jewelleryCategory: string;
  modelEthnicity: string;
  modelStyle: string;
  backgroundSetting: string;
  lightingMood: string;
  outfitStyle: string;
  composition: string;
  customNotes?: string;
}): string {
  const lines: string[] = [
    "Generate a high-end luxury marketing photograph for an Indian jewellery brand.",
    "",
    `JEWELLERY: The attached image shows the actual jewellery piece — a ${params.jewelleryCategory}. This jewellery MUST appear in the final image exactly as shown: same design, same stones, same structure. Do not alter, simplify, or replace the jewellery.`,
    "",
    `MODEL: ${params.modelEthnicity} woman, elegant and poised, luxury fashion model aesthetic.`,
    `STYLE: ${params.modelStyle}`,
    `OUTFIT: ${params.outfitStyle}`,
    `BACKGROUND: ${params.backgroundSetting}`,
    `LIGHTING: ${params.lightingMood}`,
    `COMPOSITION: ${params.composition}`,
    "",
    "CRITICAL RULES:",
    "- The jewellery from the reference image must be worn correctly and prominently — it is the hero of the image",
    "- Necklaces sit on the collarbone/neck, earrings on ears, bangles on wrist, rings on fingers",
    "- The jewellery must be photorealistic, detailed, and clearly visible",
    "- Overall image quality must be luxury editorial standard — magazine-ready",
    "- No text, watermarks, or overlays in the image",
  ];

  if (params.customNotes) {
    lines.push("", `ADDITIONAL DIRECTION: ${params.customNotes}`);
  }

  return lines.join("\n");
}

// Generate marketing visual using Gemini with a reference jewellery image
export async function generateMarketingVisualGemini(
  jewelleryImageBase64: string,
  prompt: string
): Promise<string> {
  try {
    const response = await withRetry(() => getAI().models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: jewelleryImageBase64,
                mimeType: "image/jpeg",
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "1K",
        },
        httpOptions: {
          timeout: 180_000, // 3 minute timeout
        },
      },
    }));

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No response from Gemini marketing visual generation");
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error("No content in Gemini marketing visual response");
    }

    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return part.inlineData.data;
      }
    }

    throw new Error("No image data in Gemini marketing visual response");
  } catch (error: any) {
    throw new Error(`Gemini marketing visual failed: ${error.message}`);
  }
}

// ─── Material Analysis for AI Costing ────────────────────────────────────────

export interface MaterialBreakdown {
  polki: { sieve: string; size_mm: string; count: number }[];
  diamond: { sieve: string; size_mm: string; count: number }[];
  colorStones: { type: string; carats: number }[];
  emeralds: { size_mm: string; count: number }[];
  estimatedGoldWeightGrams: number;
  notes: string;
}

export async function analyzeDesignMaterials(
  imageBase64: string,
  designParams: {
    category: string;
    budget: number;
    materialRatio: string;
    stones: string[];
  }
): Promise<MaterialBreakdown> {
  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: imageBase64,
                mimeType: "image/png",
              },
            },
            {
              text: `You are a jewellery material estimator. Analyze this jewellery design image and estimate the materials used.

CONTEXT:
- Category: ${designParams.category}
- Budget: ₹${designParams.budget.toLocaleString("en-IN")}
- Material Ratio: ${designParams.materialRatio || "Not specified"}
- Requested Stones: ${designParams.stones.length > 0 ? designParams.stones.join(", ") : "Not specified"}

INSTRUCTIONS:
Count visible stones in the image and classify them. Use ONLY these exact values:

POLKI sieve options (uncut diamonds — irregular white/off-white stones):
- "8-10" (2–2.5mm) — tiny accent stones
- "10-12" (2.5–3.3mm) — small stones
- "12-14" (3.3–4.1mm) — medium stones
- "14-16" (4.1–5.3mm) — large feature stones

DIAMOND sieve options (round cut diamonds — small sparkling stones):
- "00-0" (1.00mm)
- "0-1" (1.10mm)
- "1-1.5" (1.20mm)
- "2-2.5" (1.30mm)

COLOR STONE types (coloured gemstones) — use ONLY these exact type names:
- "Synthetic" — generic unidentified coloured stones
- "Morganite" — pink/peach stones
- "Emerald" — standard green emeralds
- "Emerald Russian" — Russian emeralds (deeper green)
- "Emerald Colombian" — Colombian emeralds (vivid green, top quality)
- "Navratna" — mixed nine-colour stone clusters
- "Ruby" — red rubies
- "Ruby Glass Filled" — glass-filled/composite rubies
- "Sapphire" — blue/pink/yellow sapphires
- "Aquamarine" — light blue/sea-green stones
- "Tourmaline" — various coloured tourmalines
- "Amethyst" — purple stones
- "Turquoise" — turquoise/blue-green stones
- "Tanzanite" — violet-blue tanzanite
- "Spinel" — red/pink/blue spinel
- "Opal" — iridescent stones
- "Coral" — orange/red coral
- "Pearl" — standard pearls
- "Basra Pearl" — natural Basra pearls
- "JKC Pearl" — Japanese cultured pearls
- "South Sea Pearl" — large lustrous South Sea pearls
- "Onyx" — black/dark stones
- "Beryl" — green/yellow/blue beryl (non-emerald)

EMERALD sizes (sized emeralds):
- "3x2" — small
- "3.5x2" — small-medium
- "4x2" — medium
- "4x3" — large

GOLD WEIGHT: Estimate total gold weight in grams based on the visible gold framework, category type, and budget.
GOLD WEIGHT REFERENCE BY BUDGET (use these for gold weight only):
- ₹5 Lakh necklace: ~10–18g gold
- ₹10 Lakh necklace set: ~30–50g gold
- ₹25 Lakh necklace set: ~60–90g gold
- ₹1 Cr necklace set: ~100–150g gold
Scale gold weight proportionally to the budget provided above.

POLKI STONE COUNTING (critical — count from the image, not from budget):
- Examine the image carefully and count EVERY visible white/off-white uncut stone bubble
- Do NOT use the budget to guess the count — look at what is actually drawn
- Classify each stone into the sieve by its visible size relative to the gold framework
- If a design shows 12 large polki and 30 small polki, return exactly that
- Typical ranges by category for sanity-check only (do NOT anchor to these):
  Ring: 5–25 polki | Earrings: 10–40 polki | Necklace: 25–120 polki | Long Necklace Set: 60–200 polki

Return a JSON object with this exact structure:
{
  "polki": [{ "sieve": "...", "size_mm": "...", "count": N }],
  "diamond": [{ "sieve": "...", "size_mm": "...", "count": N }],
  "colorStones": [{ "type": "...", "carats": N }],
  "emeralds": [{ "size_mm": "...", "count": N }],
  "estimatedGoldWeightGrams": N,
  "notes": "Brief description of what was detected"
}

If a category has no visible stones, return an empty array for it. Be realistic — count only what you can actually see.`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as const,
          properties: {
            polki: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  sieve: { type: "string" as const },
                  size_mm: { type: "string" as const },
                  count: { type: "number" as const },
                },
                required: ["sieve", "size_mm", "count"],
              },
            },
            diamond: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  sieve: { type: "string" as const },
                  size_mm: { type: "string" as const },
                  count: { type: "number" as const },
                },
                required: ["sieve", "size_mm", "count"],
              },
            },
            colorStones: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  type: { type: "string" as const },
                  carats: { type: "number" as const },
                },
                required: ["type", "carats"],
              },
            },
            emeralds: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  size_mm: { type: "string" as const },
                  count: { type: "number" as const },
                },
                required: ["size_mm", "count"],
              },
            },
            estimatedGoldWeightGrams: { type: "number" as const },
            notes: { type: "string" as const },
          },
          required: ["polki", "diamond", "colorStones", "emeralds", "estimatedGoldWeightGrams", "notes"],
        },
      },
    });

    let responseText = "";
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          responseText = part.text;
          break;
        }
      }
    }

    if (!responseText) {
      throw new Error("No text response from Gemini material analysis");
    }

    return JSON.parse(responseText) as MaterialBreakdown;
  } catch (error: any) {
    throw new Error(`Failed to analyze design materials: ${error.message}`);
  }
}

// Interface for stone location detection
export interface StoneLocation {
  stoneName: string;
  x: number; // percentage from left (0-100)
  y: number; // percentage from top (0-100)
}

// Analyze generated image to detect stone locations for labeling
export async function analyzeImageForStoneLocations(
  imagePath: string,
  stonesList: string[]
): Promise<StoneLocation[]> {
  try {
    // Read the image file and convert to base64
    const fullPath = imagePath.startsWith('/') ? `.${imagePath}` : imagePath;
    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString('base64');

    const stonesListStr = stonesList.join(", ");
    
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: "image/png",
              },
            },
            {
              text: `Analyze this jewellery design image and identify the locations of these gemstones: ${stonesListStr}

For each stone type that you can identify in the image, provide:
1. stoneName: The name of the stone (must be one of: ${stonesListStr})
2. x: The horizontal position as a percentage from the left edge (0-100)
3. y: The vertical position as a percentage from the top edge (0-100)

Important:
- Only identify stones that are CLEARLY visible in the image
- Position should point to the CENTER of a visible instance of that stone
- If a stone type appears multiple times, pick ONE clear instance
- If a stone type is not visible, do not include it
- Polki stones are irregular white/off-white uncut diamonds
- Look for colored gems matching the stone names

Respond in JSON format: { "stones": [{ "stoneName": string, "x": number, "y": number }] }`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    let responseText = "";
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          responseText = part.text;
          break;
        }
      }
    }

    if (!responseText) {
      console.log("No response from stone detection, returning empty array");
      return [];
    }

    const result = JSON.parse(responseText);
    return result.stones || [];
  } catch (error: any) {
    console.error(`Failed to analyze image for stones: ${error.message}`);
    return []; // Return empty array on error, don't fail the whole process
  }
}

// Add labels to an image using Sharp
export async function addLabelsToImage(
  imagePath: string,
  stoneLocations: StoneLocation[]
): Promise<string> {
  const sharp = require('sharp');
  
  try {
    const fullPath = imagePath.startsWith('/') ? `.${imagePath}` : imagePath;
    
    // Get image dimensions
    const metadata = await sharp(fullPath).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;
    
    if (stoneLocations.length === 0) {
      // No labels to add, return original image
      return imagePath;
    }

    // Create SVG overlay with labels
    let svgLabels = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .label-text { 
          font-family: 'Georgia', 'Times New Roman', serif; 
          font-size: 24px; 
          font-style: italic;
          fill: #000000; 
        }
        .label-line { 
          stroke: #000000; 
          stroke-width: 1.5; 
          fill: none;
        }
      </style>`;

    stoneLocations.forEach((stone, index) => {
      // Convert percentage to pixels
      const stoneX = Math.round((stone.x / 100) * width);
      const stoneY = Math.round((stone.y / 100) * height);
      
      // Calculate label position (offset from stone)
      // Alternate sides to avoid overlap
      const isLeftSide = stone.x < 50;
      const labelOffsetX = isLeftSide ? -80 : 80;
      const labelOffsetY = (index % 3 - 1) * 40; // Stagger vertically
      
      const labelX = Math.max(60, Math.min(width - 100, stoneX + labelOffsetX));
      const labelY = Math.max(30, Math.min(height - 30, stoneY + labelOffsetY));
      
      // Draw line from label to stone
      svgLabels += `
        <line class="label-line" x1="${labelX}" y1="${labelY}" x2="${stoneX}" y2="${stoneY}" />
        <text class="label-text" x="${labelX}" y="${labelY - 5}" text-anchor="${isLeftSide ? 'end' : 'start'}">${stone.stoneName}</text>`;
    });

    svgLabels += `</svg>`;

    // Composite the SVG overlay onto the image
    const timestamp = Date.now();
    const labeledFilename = `labeled_${timestamp}.png`;
    const labeledPath = path.join("uploads", labeledFilename);

    await sharp(fullPath)
      .composite([{
        input: Buffer.from(svgLabels),
        top: 0,
        left: 0,
      }])
      .toFile(labeledPath);

    return `/uploads/${labeledFilename}`;
  } catch (error: any) {
    console.error(`Failed to add labels to image: ${error.message}`);
    // Return original image if labeling fails
    return imagePath;
  }
}
