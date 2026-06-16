// server/evaluator.ts
// Gemini Vision judge — scores generated jewellery sketches on 7 quality dimensions.
// Follows the analyzeDesignMaterials pattern from google-client.ts.
// NEVER throws from evaluateDesignQuality — generation must not fail because of evaluation.

import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return _ai;
}

export interface EvaluationScores {
  brandCompliance: number;
  viewAngle: number;
  composition: number;
  motifAccuracy: number;
  stoneRendering: number;
  goldBalance: number;
  overallQuality: number;
  reasoning: string;
}

interface EvaluationContext {
  category: string;
  motifs: string[];
  stones: string[];
  materialRatio: string;
  mode: "sketch" | "cad";
}

const EVALUATION_PROMPT = `You are an expert jewellery design quality evaluator for Raniwala 1881, a luxury Indian jewellery house.

Score this generated jewellery image on each dimension below from 1 (poor) to 5 (excellent).

SCORING DIMENSIONS:

1. brand_compliance: Does the image follow hand-drawn sketch aesthetic? (pencil lines, watercolor, no photorealism for sketch mode; photorealistic CAD render for CAD mode)
2. view_angle: Is it a flat front-view with no 3D perspective, no tilted angle? (sketch mode) or appropriate product angle? (CAD mode)
3. composition: Is the design within 70% center zone? Is the complete piece visible with no cropping?
4. motif_accuracy: Are the requested motifs present and correctly rendered?
5. stone_rendering: Are polki stones irregular white bubbles? Are colored stones correct types with pastel watercolor fill? (sketch) or realistic facets? (CAD)
6. gold_balance: Is the gold framework hairline-thin? Is the gold-to-stone ratio appropriate for the material ratio specified?
7. overall_quality: Aesthetic coherence, clean execution, no artifacts, no text/labels/watermarks

CONTEXT:
- Category: {category}
- Requested motifs: {motifs}
- Requested stones: {stones}
- Material ratio: {materialRatio}
- Mode: {mode}

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "brand_compliance": <1-5>,
  "view_angle": <1-5>,
  "composition": <1-5>,
  "motif_accuracy": <1-5>,
  "stone_rendering": <1-5>,
  "gold_balance": <1-5>,
  "overall_quality": <1-5>,
  "reasoning": "<2-3 sentence explanation of scores>"
}`;

function clampScore(val: unknown): number {
  const n = Number(val);
  if (isNaN(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

export async function evaluateDesignQuality(
  imageUrl: string,
  context: EvaluationContext
): Promise<EvaluationScores | null> {
  try {
    // Read image from disk
    const imagePath = imageUrl.startsWith("/")
      ? path.join(".", imageUrl)
      : imageUrl;

    if (!fs.existsSync(imagePath)) {
      console.warn(`[evaluator] Image not found: ${imagePath}`);
      return null;
    }

    const imageBase64 = fs.readFileSync(imagePath).toString("base64");
    const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

    const prompt = EVALUATION_PROMPT
      .replace("{category}", context.category)
      .replace("{motifs}", context.motifs.join(", ") || "None specified")
      .replace("{stones}", context.stones.join(", ") || "None specified")
      .replace("{materialRatio}", context.materialRatio || "Not specified")
      .replace("{mode}", context.mode);

    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: imageBase64, mimeType } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        httpOptions: { timeout: 30_000 },
      },
    });

    const text = response.text?.trim() || "";
    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```json?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr);

    return {
      brandCompliance: clampScore(parsed.brand_compliance),
      viewAngle: clampScore(parsed.view_angle),
      composition: clampScore(parsed.composition),
      motifAccuracy: clampScore(parsed.motif_accuracy),
      stoneRendering: clampScore(parsed.stone_rendering),
      goldBalance: clampScore(parsed.gold_balance),
      overallQuality: clampScore(parsed.overall_quality),
      reasoning: String(parsed.reasoning || ""),
    };
  } catch (error) {
    console.warn(
      "[evaluator] Evaluation failed:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/**
 * Fire-and-forget evaluation of a model result.
 * Catches all errors — never throws.
 */
export async function fireAndForgetEvaluation(
  designProjectId: string,
  modelProvider: string,
  imageUrl: string | null,
  context: EvaluationContext,
  promptVersionId: string | null,
  createEvaluation: (data: {
    designProjectId: string;
    modelProvider: string;
    imageUrl: string;
    brandCompliance: number;
    viewAngle: number;
    composition: number;
    motifAccuracy: number;
    stoneRendering: number;
    goldBalance: number;
    overallQuality: number;
    reasoning: string | null;
    promptVersionId: string | null;
  }) => Promise<unknown>
): Promise<void> {
  try {
    if (!imageUrl) return;

    const scores = await evaluateDesignQuality(imageUrl, context);
    if (!scores) return;

    await createEvaluation({
      designProjectId,
      modelProvider,
      imageUrl,
      brandCompliance: scores.brandCompliance,
      viewAngle: scores.viewAngle,
      composition: scores.composition,
      motifAccuracy: scores.motifAccuracy,
      stoneRendering: scores.stoneRendering,
      goldBalance: scores.goldBalance,
      overallQuality: scores.overallQuality,
      reasoning: scores.reasoning,
      promptVersionId,
    });

    console.log(
      `[evaluator] ${modelProvider} scored: overall=${scores.overallQuality}, brand=${scores.brandCompliance}, view=${scores.viewAngle}`
    );
  } catch (error) {
    console.warn(
      `[evaluator] Fire-and-forget failed for ${modelProvider}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
