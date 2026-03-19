# Style Preservation Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the Modify page so product photographs produce photorealistic output instead of hand-drawn sketches.

**Architecture:** Two changes — (1) fix a MIME type bug where uploaded JPEGs are saved without conversion, (2) add a Vision analysis step that auto-detects the input image's visual style and injects the description into the modify prompt so Gemini preserves the medium.

**Tech Stack:** Express.js + TypeScript, Google Gemini (`@google/genai`), Sharp for image conversion.

---

## Task 1: Fix MIME type bug in `server/routes.ts`

**Files:**
- Modify: `server/routes.ts:808`

The current code writes the raw upload buffer (which may be JPEG) directly to a `.png` file, then Gemini receives JPEG bytes labeled as `mimeType: "image/png"`. Sharp is already imported in this file (`import sharp from "sharp"`).

**Step 1: Replace the raw buffer write with a Sharp PNG conversion**

In `server/routes.ts`, find line 808:
```typescript
await fs.writeFile(inputPath, req.file.buffer);
```

Replace it with:
```typescript
const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
await fs.writeFile(inputPath, pngBuffer);
```

Also update the comment on line 805 from:
```typescript
// Save uploaded buffer to disk so editJewellerySketch can read it
```
to:
```typescript
// Convert upload to PNG (ensures correct MIME type for Gemini) and save to disk
```

**Step 2: Verify TypeScript — run check**

```
cd C:\Projects\jewellery-main && npm run check
```

Expected: only the pre-existing `server/db.ts` error about `@types/pg`. No new errors.

---

## Task 2: Add `analyzeImageStyle()` to `server/google-client.ts`

**Files:**
- Modify: `server/google-client.ts` — add function after line 503 (end of `modifyJewelleryImage`)

Add this exported function immediately after the closing `}` of `modifyJewelleryImage`:

```typescript
// Analyze an image's visual style using Gemini Vision (text-only output)
export async function analyzeImageStyle(imagePath: string): Promise<string> {
  try {
    const fullPath = imagePath.startsWith("/uploads/")
      ? path.join(".", imagePath)
      : imagePath;

    if (!fs.existsSync(fullPath)) {
      return "jewellery image";
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString("base64");

    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64Image, mimeType: "image/png" } },
            {
              text: "Describe the visual style and rendering medium of this image in one focused sentence. Include: is it a photograph or illustration, the background surface/colour, lighting type, and how the materials (metal, stones) are rendered. Be specific and concise.",
            },
          ],
        },
      ],
    });

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) return "jewellery image";
    const content = candidates[0].content;
    if (!content || !content.parts) return "jewellery image";

    for (const part of content.parts) {
      if (part.text) return part.text.trim();
    }

    return "jewellery image";
  } catch {
    return "jewellery image";
  }
}
```

**Step 3: Verify TypeScript — run check**

```
cd C:\Projects\jewellery-main && npm run check
```

Expected: same pre-existing error only.

---

## Task 3: Update `modifyJewelleryImage()` to use Vision-detected style

**Files:**
- Modify: `server/google-client.ts:430–503`

**Step 1: Replace the static `fullPrompt` with a dynamic style-anchored version**

In `modifyJewelleryImage`, find the block starting at line 446:
```typescript
const fullPrompt = `You are modifying an existing jewellery image.

CRITICAL STYLE RULE: Preserve EXACTLY the visual style ...
```
(the entire multiline template literal ending at line 463)

Replace the entire function body from `const imageBuffer = ...` through the end of the prompt string with this updated version:

```typescript
    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString("base64");

    // Step 1: Auto-detect the input's visual style via Gemini Vision
    const styleDescription = await analyzeImageStyle(fullPath);

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

MODIFICATION REQUEST:
${editPrompt}

Output must be visually indistinguishable in style from the original image.`;
```

**Step 2: Verify TypeScript — run check**

```
cd C:\Projects\jewellery-main && npm run check
```

Expected: same pre-existing error only.

---

## Task 4: Manual end-to-end verification

**Step 1: Restart the dev server** (kill any running instance on port 5000, then):

```
cd C:\Projects\jewellery-main && npm run dev
```

**Step 2: Open the Modify page** at `http://localhost:5000/modify`

**Step 3: Upload the kundan product photo** — upload `uploads/modify_input_1773223993834.png` (the real photo of the kundan necklace on green velvet). Select any 1–2 parameters (e.g. Stone Colour: Emerald). Click **Modify Design**.

**Expected:** Output image looks like a product photograph — gold metal, realistic stones, green or similar background. NOT a pencil sketch.

**Step 4: Upload a sketch** — upload any file from `uploads/generated_*.png` (these are hand-drawn sketches). Apply parameters. Click **Modify Design**.

**Expected:** Output remains in sketch/illustration style, not converted to a photograph.
