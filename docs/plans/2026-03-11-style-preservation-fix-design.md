# Design: Modify Page — Photorealistic Style Preservation

**Date:** 2026-03-11
**Status:** Approved

---

## Problem

The `/modify` page accepts any image (product photographs, 3D renders, sketches) but always outputs a hand-drawn pencil sketch. Two root causes:

1. **MIME type bug** — Uploaded files (typically JPEG) are saved to disk as `.png` without format conversion. Gemini receives JPEG byte data labeled as `mimeType: "image/png"`, causing misparse or silent style corruption.

2. **Generic style-preservation prompt** — `modifyJewelleryImage()` tells Gemini to "preserve the style" in abstract terms, but the model's generative bias overrides this and defaults to its native illustration style.

---

## Approach: MIME Fix + Vision Analysis + Style-Anchored Prompt

### Step 1 — MIME type fix (`server/routes.ts`)

In the `/api/modify-design` route, after receiving `req.file.buffer`, convert the upload to real PNG using Sharp before writing to disk:

```typescript
const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
await fsPromises.writeFile(inputPath, pngBuffer);
```

Sharp is already imported and used in the project. This ensures `mimeType: "image/png"` correctly matches the file content.

### Step 2 — New `analyzeImageStyle()` function (`server/google-client.ts`)

Add an exported function that takes an image path and calls Gemini Vision (text-only response — no IMAGE modality) with the question:

> "Describe the visual style and rendering medium of this image in one focused sentence. Include: is it a photograph or illustration, the background surface/colour, lighting type, and how the materials (metal, stones) are rendered."

Returns a string like:
*"Professional studio product photograph of gold kundan jewellery on dark green velvet, soft diffused studio lighting, realistic reflective metallic surfaces and polished stone facets."*

### Step 3 — Updated `modifyJewelleryImage()` (`server/google-client.ts`)

Call `analyzeImageStyle()` first, then inject the result into the modify prompt:

```
You are editing an existing jewellery image.

ORIGINAL IMAGE STYLE (auto-detected):
"{styleDescription}"

CRITICAL REQUIREMENT: Your output MUST exactly match the original image's visual style described above.
- If the original is a product photograph → output must be a product photograph
- If the original is a hand-drawn sketch → output must remain a hand-drawn sketch
- Do NOT convert to a different medium under any circumstances
- Preserve the background, lighting, material rendering, and overall look

FORBIDDEN: sketches, line drawings, illustrations, pencil outlines, artistic rendering of any kind if the original is a photograph.

CRITICAL LAYOUT RULES:
- Keep ALL elements at least 12% away from every edge
- The ENTIRE design must be COMPLETE — no cropping, no cutoffs

MODIFICATION REQUEST:
{editPrompt}

Output must be visually indistinguishable in style from the original image.
```

---

## Files to Change

| File | Change |
|------|--------|
| `server/routes.ts` | Use `sharp(...).png().toBuffer()` before writing modify input file |
| `server/google-client.ts` | Add `analyzeImageStyle()` function; update `modifyJewelleryImage()` to call it and inject style description |

---

## Verification

1. Upload the kundan product photo → apply some params → click Modify Design → output should be a product photograph, not a sketch
2. Upload a hand-drawn sketch → modify → output should remain a sketch
3. Upload a 3D render → modify → output should remain 3D render style
4. `npm run check` — only pre-existing db.ts error, no new errors
