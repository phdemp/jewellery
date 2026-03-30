import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

/** Valid aspect ratios accepted by the xAI image API. */
export type GrokAspectRatio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16";

/** Shape of a successful xAI image generation response. */
interface XaiImageResponse {
  data: Array<{ b64_json?: string }>;
}

/** Shape of an xAI API error body. */
interface XaiErrorResponse {
  error?: { message?: string };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let _grok: OpenAI | null = null;
function getGrok(): OpenAI {
  if (!_grok) {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      throw new Error("GROK_API_KEY environment variable is not set");
    }
    _grok = new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" });
  }
  return _grok;
}

/**
 * Text-to-image generation using xAI's grok-imagine-image model.
 * Used by: Home (generate-design), CAD Comparison.
 * Returns: URL path to saved PNG file (e.g., "/uploads/grok_1234.png").
 */
// Grok's image model needs front-view instructions at the START of the prompt
// since it tends to ignore instructions buried deep in long prompts.
const GROK_VIEW_PREFIX = `CRITICAL: Generate a FLAT FRONT-VIEW image only. No 3/4 angle, no perspective, no tilted view, no side angle. The jewellery must face the viewer straight-on as a 2D technical drawing.\n\n`;

// Animal motif names that can trigger xAI content moderation when embedded
// in long prompts. Replace with the generic word "motif" before sending.
const GROK_CONTENT_FILTER_WORDS = [
  "tiger", "panther", "lion", "elephant", "peacock", "parrot",
  "swan", "horse", "bear", "dolphin", "turtle",
];
const GROK_FILTER_RE = new RegExp(
  `\\b(${GROK_CONTENT_FILTER_WORDS.join("|")})\\b`,
  "gi"
);

function sanitizeForGrok(prompt: string): string {
  return prompt.replace(GROK_FILTER_RE, "motif");
}

export async function generateImageWithGrok(
  prompt: string,
  aspectRatio: GrokAspectRatio = "1:1"
): Promise<string> {
  try {
    const response = await getGrok().images.generate({
      model: "grok-imagine-image",
      prompt: GROK_VIEW_PREFIX + sanitizeForGrok(prompt),
      response_format: "b64_json",
      // @ts-expect-error — xAI-specific parameter not in OpenAI types
      aspect_ratio: aspectRatio,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in Grok response");

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const filename = `grok_${timestamp}_${rand}.png`;
    const filepath = path.join("uploads", filename);
    await fs.writeFile(filepath, Buffer.from(b64, "base64"));
    return `/uploads/${filename}`;
  } catch (error: unknown) {
    throw new Error(`Failed to generate image with Grok: ${getErrorMessage(error)}`);
  }
}

/**
 * Image-to-image editing using xAI's /v1/images/edits endpoint.
 * IMPORTANT: Uses direct fetch, NOT OpenAI SDK — xAI requires JSON body,
 * but OpenAI SDK sends multipart/form-data for edits.
 * Used by: Modify (modify-design).
 * Returns: URL path to saved PNG file.
 */
export async function modifyImageWithGrok(
  sourceImagePath: string,
  editPrompt: string
): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) throw new Error("GROK_API_KEY environment variable is not set");

  try {
    const imageBuffer = await fs.readFile(sourceImagePath);
    const base64 = imageBuffer.toString("base64");

    const response = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt: GROK_VIEW_PREFIX + sanitizeForGrok(editPrompt),
        image: { url: `data:image/png;base64,${base64}`, type: "image_url" },
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err: XaiErrorResponse = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `xAI API returned ${response.status}`);
    }

    const data: XaiImageResponse = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in Grok edit response");

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const filename = `grok_modified_${timestamp}_${rand}.png`;
    const filepath = path.join("uploads", filename);
    await fs.writeFile(filepath, Buffer.from(b64, "base64"));
    return `/uploads/${filename}`;
  } catch (error: unknown) {
    throw new Error(`Failed to modify image with Grok: ${getErrorMessage(error)}`);
  }
}

/**
 * Marketing visual generation — image editing with marketing context.
 * Uses the same /v1/images/edits endpoint with base64 input.
 * Used by: Marketing (generate-marketing).
 * Returns: base64 PNG string (matches Gemini marketing function signature).
 */
export async function generateMarketingVisualGrok(
  jewelleryImageBase64: string,
  prompt: string
): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) throw new Error("GROK_API_KEY environment variable is not set");

  try {
    const response = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt,
        image: { url: `data:image/jpeg;base64,${jewelleryImageBase64}`, type: "image_url" },
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err: XaiErrorResponse = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `xAI API returned ${response.status}`);
    }

    const data: XaiImageResponse = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in Grok marketing response");

    return b64;
  } catch (error: unknown) {
    throw new Error(`Grok marketing visual failed: ${getErrorMessage(error)}`);
  }
}
