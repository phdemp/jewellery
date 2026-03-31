# Multi-Model Image Generation Across All Pages

**Date:** 2026-03-19
**Status:** Draft

## Summary

Add Grok (xAI `grok-imagine-image`) as a third image generation model alongside Gemini 3 Pro Image Preview and OpenAI gpt-image-1. All 4 image-generating pages run all 3 models in parallel and display results side-by-side for comparison.

## Affected Pages & Endpoints

| Page | Endpoint | Current Models | New Models |
|------|----------|---------------|------------|
| Home (`/`) | `POST /api/generate-design` | Gemini (sketch) or OpenAI (CAD) — single output | Gemini + OpenAI + Grok — 3 outputs |
| Modify (`/modify`) | `POST /api/modify-design` | OpenAI primary, Gemini fallback — single output | Gemini + OpenAI + Grok — 3 outputs |
| CAD Comparison (`/cad-comparison`) | `POST /api/generate-cad-comparison` | Gemini + OpenAI — 2 outputs | Gemini + OpenAI + Grok — 3 outputs |
| Marketing (`/marketing`) | `POST /api/generate-marketing` | Gemini + OpenAI — 2 outputs | Gemini + OpenAI + Grok — 3 outputs |

Pages NOT changed: Comparison (`/comparison`) retains its RAG-vs-no-RAG purpose. References (`/references`) is upload-only.

## New File: `server/grok-client.ts`

### xAI API Details

- **Model:** `grok-imagine-image`
- **Base URL:** `https://api.x.ai/v1`
- **Text-to-image:** `POST /v1/images/generations` (JSON body)
- **Image editing:** `POST /v1/images/edits` (JSON body — NOT multipart/form-data)
- **Important:** Cannot use OpenAI SDK's `images.edit()` — it sends multipart/form-data. xAI requires `application/json`. Must use direct `fetch` for the edits endpoint.
- **Image input for edits:** base64 data URI (`data:image/png;base64,{encoded}`) or public URL
- **Aspect ratios:** `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`, `"3:4"`, etc. (not pixel dimensions)

### Exports

```typescript
// Text-to-image generation (for Home, CAD Comparison)
export async function generateImageWithGrok(
  prompt: string,
  aspectRatio?: string // "1:1" | "3:4" etc.
): Promise<string>
// Returns: saved file URL path (e.g., "/uploads/grok_1234.png")

// Image-to-image editing (for Modify)
// Uses direct fetch to /v1/images/edits (JSON body, NOT OpenAI SDK)
export async function modifyImageWithGrok(
  sourceImagePath: string,
  prompt: string
): Promise<string>
// Returns: saved file URL path

// Marketing visual generation (for Marketing)
export async function generateMarketingVisualGrok(
  base64Image: string,
  prompt: string
): Promise<string>
// Returns: base64 PNG string (matches Gemini marketing function signature)
```

### Implementation Pattern

```typescript
import OpenAI from "openai";

// OpenAI SDK for text-to-image generation only
const grokClient = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

// Text-to-image: use OpenAI SDK
async function generateImageWithGrok(prompt, aspectRatio = "1:1") {
  const response = await grokClient.images.generate({
    model: "grok-imagine-image",
    prompt,
    response_format: "b64_json",
    // @ts-ignore — xAI extension
    aspect_ratio: aspectRatio,
  });
  // Decode base64 → save to uploads/grok_{ts}.png → return URL path
}

// Image editing: use direct fetch (xAI requires JSON, not multipart)
async function modifyImageWithGrok(sourceImagePath, prompt) {
  const imageBuffer = await fs.readFile(sourceImagePath);
  const base64 = imageBuffer.toString("base64");
  const response = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-imagine-image",
      prompt,
      image: `data:image/png;base64,${base64}`,
      response_format: "b64_json",
    }),
  });
  // Decode base64 → save to uploads/grok_{ts}.png → return URL path
}
```

- Images saved to `uploads/grok_{timestamp}.png`
- Same error handling pattern as `openai-client.ts`

## Shared Response Interface

All endpoints use this structure for each model result:

```typescript
interface ModelResult {
  imageUrl: string | null;
  error: string | null;
  model: string; // "gemini-3-pro-image-preview", "gpt-image-1", "grok-imagine-image"
}
```

All model results across ALL endpoints use `ModelResult` uniformly (nullable imageUrl, includes error field). This standardizes the interface — the existing CAD Comparison and Marketing responses are updated to match.

### Per-Endpoint Responses

**`/api/generate-design`** — changes from `DesignGenerationResponse` to:
```typescript
{
  id: string;
  sketchPlan: string;
  imagePrompt: string;
  generatedImageUrl: string; // kept for backward compat — first successful URL
  gemini: ModelResult;
  openai: ModelResult;
  grok: ModelResult;
  usedReferences: number;
}
```
`generatedImageUrl` is kept (set to first successful URL: Gemini > OpenAI > Grok) for backward compatibility with `ResultDisplay` iteration/editing features and DB storage.

**`/api/modify-design`** — changes from `ModifyDesignResponse` to:
```typescript
{
  id: string;
  sketchPlan: string;
  imagePrompt: string;
  generatedImageUrl: string; // first successful URL
  gemini: ModelResult;
  openai: ModelResult;
  grok: ModelResult;
  usedReferences: number;
  costReport?: CostingReportData | null;
}
```
AI costing runs on the first successful image (Gemini preferred).

**`/api/generate-cad-comparison`** — standardized to `ModelResult`:
```typescript
{
  gemini: ModelResult;
  openai: ModelResult;
  grok: ModelResult;
  prompt: string;
}
```
Previously `gemini.imageUrl` was non-nullable and threw 500 if Gemini failed. Now all 3 are nullable with independent error handling. Frontend must handle null imageUrls.

**`/api/generate-marketing`** — standardized with `model` field added:
```typescript
{
  projectId: string | null;
  prompt: string;
  gemini: ModelResult;
  openai: ModelResult;
  grok: ModelResult;
}
```

## Server-Side Changes Per Endpoint

### `POST /api/generate-design`

Current: `generateJewellerySketch(BRAND_RULES + imagePrompt)` → single URL.

New (sketch mode):
```typescript
const [geminiResult, openaiResult, grokResult] = await Promise.allSettled([
  generateJewellerySketch(BRAND_RULES + "\n\n" + imagePrompt),
  generateCADImageWithOpenAI(BRAND_RULES + "\n\n" + imagePrompt, size),
  generateImageWithGrok(BRAND_RULES + "\n\n" + imagePrompt, aspectRatio),
]);
```

For CAD mode, all 3 use `CAD_RULES + cadPrompt` (via `buildCADPrompt()` which is defined in `routes.ts`).

DB project stores `generatedImageUrl` = first successful URL (Gemini > OpenAI > Grok).

### `POST /api/modify-design`

Current: `modifyImageWithOpenAI()` → Gemini fallback → single URL (temp file deleted in `finally`).

New:
```typescript
const [geminiResult, openaiResult, grokResult] = await Promise.allSettled([
  modifyJewelleryImage(path.resolve(inputPath), editPrompt),
  modifyImageWithOpenAI(path.resolve(inputPath), editPrompt),
  modifyImageWithGrok(path.resolve(inputPath), editPrompt),
]);
```

**Temp file cleanup:** The `finally` block that deletes `inputPath` must wrap the `Promise.allSettled` call so the file persists until all 3 models have read it.

AI costing runs on the first successful result (prefer Gemini > OpenAI > Grok).

### `POST /api/generate-cad-comparison`

Current: `Promise.allSettled([gemini, openai])`. Throws 500 if Gemini fails.

New: Add `generateImageWithGrok(cadPrompt, aspectRatio)` as third entry. Remove the Gemini-must-succeed throw — all 3 are independent. At least one must succeed or return 500.

### `POST /api/generate-marketing`

Current: `Promise.allSettled([gemini, openai])`.

New: Add `generateMarketingVisualGrok(base64Image, prompt)` as third entry. Save to `designs/marketing/{ts}-grok.png`.

## Client-Side Changes

### `client/src/lib/api.ts`

- Add `ModelResult` interface export
- Add `gemini`, `openai`, `grok` fields (type `ModelResult`) to `DesignGenerationResponse`
- Keep `generatedImageUrl` in `DesignGenerationResponse` (backward compat for `ResultDisplay` iteration)
- Update `ModifyDesignResponse` — add `gemini`, `openai`, `grok` fields
- Update `CADComparisonResult` — standardize to `ModelResult` for all 3, add `grok`
- Update `MarketingVisualResponse` — add `model` field to existing results, add `grok`

### New Component: `client/src/components/multi-model-result.tsx`

A reusable component that renders 3 model results in a responsive grid.

Props:
```typescript
interface MultiModelResultProps {
  gemini: ModelResult;
  openai: ModelResult;
  grok: ModelResult;
  category?: string;
  projectId?: string;
}
```

Behavior:
- 3-column grid on desktop (`lg:grid-cols-3`), single column on mobile
- Each card: model name badge at top, image or loading/error state, same visual style as existing result cards
- Cards render independently — if one model fails, it shows an error state while others show images
- Reuses existing card/image styling from the app

### Edit/Iterate Workflow

`ResultDisplay` provides edit/iterate capabilities (edit prompt → new iteration). With multi-model output:
- `generatedImageUrl` (first successful URL) is stored in the DB project for iteration purposes
- `ResultDisplay` continues to work for the primary image (edit/iterate/save/download)
- `MultiModelResult` shows all 3 outputs above `ResultDisplay` for comparison
- Editing always operates on the primary (`generatedImageUrl`) image

Layout on Home and Modify pages:
1. `MultiModelResult` — 3-card comparison grid (view-only)
2. `ResultDisplay` — primary image with full edit/iterate/save controls (below)

### Page Changes

**`pages/home.tsx`**
- Add `MultiModelResult` above `ResultDisplay`
- `ResultDisplay` still receives `generatedImageUrl` for edit/iterate features

**`pages/modify.tsx`**
- Add `MultiModelResult` above `ResultDisplay`
- Cost report renders below all components

**`pages/cad-comparison.tsx`**
- Add third card for Grok (standardize existing cards to handle nullable imageUrl)

**`pages/marketing.tsx`**
- Add third card for Grok (already handles nullable imageUrl)

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GROK_API_KEY` | Optional | xAI API key — already in `.env` |

If `GROK_API_KEY` is missing, Grok functions throw descriptive errors. The `Promise.allSettled` pattern ensures missing keys don't block other models — the Grok card will show an error state.

## Error Handling

- Each model result is independent via `Promise.allSettled()`
- If a model fails, its `ModelResult.error` is set and `imageUrl` is null
- Frontend shows error text in that model's card while other cards show results
- If ALL 3 fail, show a combined error toast
- DB project stores the first successful URL; if none succeed, endpoint returns 500

## Files Changed

| File | Change Type |
|------|------------|
| `server/grok-client.ts` | **New** — Grok API client (text-to-image via OpenAI SDK, image editing via direct fetch) |
| `server/routes.ts` | **Modified** — all 4 endpoints get 3-way parallel generation |
| `client/src/lib/api.ts` | **Modified** — response interfaces updated, `ModelResult` added |
| `client/src/components/multi-model-result.tsx` | **New** — shared 3-model comparison grid component |
| `client/src/pages/home.tsx` | **Modified** — add MultiModelResult above ResultDisplay |
| `client/src/pages/modify.tsx` | **Modified** — add MultiModelResult above ResultDisplay |
| `client/src/pages/cad-comparison.tsx` | **Modified** — add Grok card, standardize to ModelResult |
| `client/src/pages/marketing.tsx` | **Modified** — add Grok card |
| `CLAUDE.md` | **Modified** — add GROK_API_KEY to env vars, add grok-client.ts to file structure |
