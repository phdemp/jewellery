# TODO: Marketing Visual Generator — Model wearing jewellery

> Feed this file to the AI assistant with: `claude -p TODO.md`
> Complete all tasks in order — each task depends on the previous one.

---

## Overview

Build a new `/marketing` page where the team uploads a real jewellery product photo, selects model styling preferences and editorial direction, and the system generates a full editorial marketing visual — model + outfit + background + jewellery — using both Gemini and OpenAI simultaneously, displayed side by side.

**Files to create:**
- `client/src/pages/marketing.tsx`

**Files to modify:**
- `client/src/App.tsx`
- `client/src/components/layout.tsx`
- `client/src/lib/api.ts`
- `server/routes.ts`
- `server/google-client.ts`

**Files to leave untouched:**
- `server/storage.ts`, `server/vector-store.ts`, `server/db.ts`, `shared/schema.ts`

---

## Constant Reference — Add to `client/src/lib/api.ts`

Add this constant alongside the API functions. It drives all the form dropdowns on the marketing page.

```typescript
export const MARKETING_FORM_OPTIONS = {
  modelEthnicity: [
    "Indian / South Asian",
    "East Asian",
    "Middle Eastern",
    "Western / European",
    "African",
    "Mixed / AI decides"
  ],
  modelStyle: [
    "Indian Bridal — heavy lehenga, full jewellery styling, ornate backdrop",
    "Indian Traditional — saree, classic studio setting",
    "Modern Editorial — minimal outfit, clean high-fashion aesthetic",
    "Fusion Contemporary — modern Indian wear, lifestyle setting"
  ],
  backgroundSetting: [
    "Luxury studio — white/ivory seamless backdrop",
    "Royal palace interior — arches, marble, warm light",
    "Garden / floral — lush greenery, soft natural light",
    "Rooftop at golden hour — warm ambient light, city backdrop",
    "Dark dramatic — deep jewel-toned background, moody lighting",
    "Minimalist — clean gradient, product-focused"
  ],
  lightingMood: [
    "Soft diffused — flattering, even, editorial",
    "Golden hour — warm, glowing, festive",
    "High contrast — dramatic shadows, luxury feel",
    "Natural daylight — fresh, clean, modern",
    "Studio strobe — sharp, commercial, high clarity"
  ],
  outfitStyle: [
    "Heavy bridal lehenga — red / maroon",
    "Heavy bridal lehenga — ivory / gold",
    "Silk saree — traditional drape",
    "Contemporary lehenga — pastel",
    "Anarkali / churidar — formal",
    "Minimal — bare shoulder / blouse focus (jewellery focal)",
    "Western formal — black gown"
  ],
  composition: [
    "Close-up portrait — face and neckline, jewellery focal",
    "Half body — waist up, full necklace and earrings visible",
    "Three-quarter — knees up, shows full look",
    "Full length — head to toe editorial",
    "Detail close-up — extreme close on the jewellery piece"
  ],
  jewelleryCategory: [
    "Necklace / Necklace Set",
    "Choker / Choker Set",
    "Long Necklace",
    "Earrings",
    "Bangles",
    "Bracelet",
    "Ring",
    "Maangtika",
    "Nath / Nosepin",
    "Hathphool",
    "Full Bridal Set"
  ]
} as const;
```

---

## TASK 1 — Add AI generation wrappers to `server/google-client.ts`

Add two new exported functions at the bottom of the file. Do not modify existing functions.

### Function 1: Gemini marketing visual

```typescript
export async function generateMarketingVisualGemini(
  jewelleryImageBase64: string,
  prompt: string
): Promise<string>
```

Implementation:
- Use the existing Gemini client (`genAI`) already initialised in the file
- Model: use the same image generation model already used in `generateJewellerySketch()`
- Pass `jewelleryImageBase64` as an inline image part alongside the text prompt
- Return the base64 PNG string of the generated image
- Throw a descriptive error if generation fails or returns no image

### Function 2: OpenAI marketing visual

```typescript
export async function generateMarketingVisualOpenAI(
  jewelleryImageBase64: string,
  prompt: string
): Promise<string>
```

Implementation:
- Use the existing OpenAI client already initialised in the file
- Model: `gpt-image-1`
- Pass the jewellery image as a base64 input image
- Size: `"1024x1024"`
- Quality: `"high"`
- Return the base64 PNG string
- Throw a descriptive error if generation fails

### Function 3: Prompt builder

```typescript
export function buildMarketingPrompt(params: {
  jewelleryCategory: string;
  modelEthnicity: string;
  modelStyle: string;
  backgroundSetting: string;
  lightingMood: string;
  outfitStyle: string;
  composition: string;
  customNotes?: string;
}): string
```

Build and return the following prompt string, only including lines where the value is non-empty:

```
Generate a high-end luxury marketing photograph for an Indian jewellery brand.

JEWELLERY: The attached image shows the actual jewellery piece — a {jewelleryCategory}. This jewellery MUST appear in the final image exactly as shown: same design, same stones, same structure. Do not alter, simplify, or replace the jewellery.

MODEL: {modelEthnicity} woman, elegant and poised, luxury fashion model aesthetic.
STYLE: {modelStyle}
OUTFIT: {outfitStyle}
BACKGROUND: {backgroundSetting}
LIGHTING: {lightingMood}
COMPOSITION: {composition}

CRITICAL RULES:
- The jewellery from the reference image must be worn correctly and prominently — it is the hero of the image
- Necklaces sit on the collarbone/neck, earrings on ears, bangles on wrist, rings on fingers
- The jewellery must be photorealistic, detailed, and clearly visible
- Overall image quality must be luxury editorial standard — magazine-ready
- No text, watermarks, or overlays in the image

{customNotes ? "ADDITIONAL DIRECTION: " + customNotes : ""}
```

---

## TASK 2 — Add `POST /api/generate-marketing` to `server/routes.ts`

Register this route **before** the wildcard static file handler at the bottom of the file.

**Multer:** Use the existing `memUpload` / `memStorage` instance. Do not create a new one.

### Request shape (multipart/form-data)

| Field | Type | Required |
|-------|------|----------|
| `image` | file | Yes |
| `jewelleryCategory` | string | Yes |
| `modelEthnicity` | string | Yes |
| `modelStyle` | string | Yes |
| `backgroundSetting` | string | Yes |
| `lightingMood` | string | Yes |
| `outfitStyle` | string | Yes |
| `composition` | string | Yes |
| `customNotes` | string | No |

### Handler logic

1. If `req.file` is missing, return `400 { error: "Jewellery image is required" }`

2. Convert `req.file.buffer` to base64 string

3. Call `buildMarketingPrompt(params)` using the submitted fields

4. Run both AI models **in parallel** using `Promise.allSettled()` — do NOT use `Promise.all()` so that one failure does not block the other:

```typescript
const [geminiResult, openaiResult] = await Promise.allSettled([
  generateMarketingVisualGemini(base64Image, prompt),
  generateMarketingVisualOpenAI(base64Image, prompt)
]);
```

5. For each settled result:
   - If `status === "fulfilled"`: decode the base64 PNG, save to `designs/marketing/{Date.now()}-gemini.png` or `-openai.png` — create the directory if it does not exist
   - If `status === "rejected"`: set that model's result to `null` and log the error

6. Call `storage.createDesignProject()` once, using the first successful result as the primary image. Pass:
   - `category`: `jewelleryCategory`
   - `theme`: `modelStyle`
   - `motifs`: `[]`
   - `stones`: `[]`
   - `materialRatio`: `""`
   - `customNotes`: `customNotes || ""`
   - `sketchPlan`: the full prompt string
   - `imagePrompt`: the full prompt string
   - `generatedImageUrl`: URL of the first successful image

7. Build the response object:

```typescript
{
  projectId: string,
  prompt: string,
  gemini: {
    imageUrl: string | null,
    error: string | null
  },
  openai: {
    imageUrl: string | null,
    error: string | null
  }
}
```

8. Return `200` with the response object
9. Wrap in try/catch — return `500 { error: err.message }` on total failure

---

## TASK 3 — Add types and API function to `client/src/lib/api.ts`

### Types to add

```typescript
export interface MarketingVisualParams {
  jewelleryCategory: string;
  modelEthnicity: string;
  modelStyle: string;
  backgroundSetting: string;
  lightingMood: string;
  outfitStyle: string;
  composition: string;
  customNotes?: string;
}

export interface MarketingVisualResult {
  imageUrl: string | null;
  error: string | null;
}

export interface MarketingVisualResponse {
  projectId: string;
  prompt: string;
  gemini: MarketingVisualResult;
  openai: MarketingVisualResult;
}
```

### Function to add

```typescript
export async function generateMarketingVisual(
  imageFile: File,
  params: MarketingVisualParams
): Promise<MarketingVisualResponse>
```

Implementation:
- Use `FormData`
- Append the image file with key `"image"`
- Append each param field individually
- POST to `/api/generate-marketing`
- Throw a descriptive error if response is not ok

---

## TASK 4 — Register route in `client/src/App.tsx`

```tsx
import MarketingPage from "@/pages/marketing";

// Inside the Switch block:
<Route path="/marketing" component={MarketingPage} />
```

---

## TASK 5 — Add nav link in `client/src/components/layout.tsx`

Add alongside existing nav links:

```tsx
<Link href="/marketing">Marketing Visuals</Link>
```

Match the exact className and styling of the existing nav links.

---

## TASK 6 — Create `client/src/pages/marketing.tsx`

Build the full page. Match the visual language of `home.tsx` exactly — same hero strip pattern, same card/section styling, same Tailwind color tokens.

---

### Page structure

```
[Hero strip — "Marketing Visual Generator"]
[OrnamentalDivider]
[Two-column grid]
  Left:  Upload panel + parameter form
  Right: Results panel (side-by-side Gemini vs OpenAI)
```

---

### Left column — Part A: Image Upload Panel

- Dashed amber/gold border upload zone
- Click to browse OR drag-and-drop
- Accepted types: `image/jpeg`, `image/png`, `image/webp`
- On file select: show image preview (max height 200px, object-fit contain), filename, file size
- Clear/remove button resets selection
- State: `const [uploadedFile, setUploadedFile] = useState<File | null>(null)`

---

### Left column — Part B: Parameter Form

Use **React Hook Form + Zod**. All fields required except `customNotes`.

Import `MARKETING_FORM_OPTIONS` from `lib/api.ts` and use it to populate all dropdowns — do not hardcode option strings in the JSX.

**Jewellery Category** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.jewelleryCategory`
Purpose: tells the AI what kind of jewellery it is so it places it correctly on the body

**Model Ethnicity** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.modelEthnicity`

**Model Style** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.modelStyle`
Label: "Overall style & setting"

**Background Setting** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.backgroundSetting`

**Lighting Mood** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.lightingMood`

**Outfit Style** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.outfitStyle`

**Composition / Framing** — `<Select>`
Source: `MARKETING_FORM_OPTIONS.composition`

**Additional Direction** — `<Textarea>`
Placeholder: `"Any specific instructions — occasion, campaign theme, colour palette, mood..."`

**Submit button** — label: `"Generate Marketing Visual"`
- Disabled when `uploadedFile` is null or `isLoading` is true
- Show spinner when loading
- Below the button, show a small muted note: `"Both Gemini and OpenAI will generate simultaneously. This takes 20–40 seconds."`

---

### Right column — Results Panel

#### Before submission — empty state
Show an elegant placeholder:
- Ornamental decorative element (reuse `OrnamentalDivider` or a simple gold border box)
- Text: `"Upload a jewellery image and select your styling preferences to generate a luxury marketing visual."`
- Muted secondary text: `"Two AI interpretations will appear here, side by side."`

#### During generation — loading state
Show two side-by-side skeleton cards with:
- Each card labelled with the model name (Gemini / OpenAI)
- Animated pulse placeholder where the image will appear
- Status text below each: `"Generating..."` — update to `"Done"` or `"Failed"` as each resolves
- Since both run in parallel but may finish at different times, use per-model loading state:

```typescript
const [geminiLoading, setGeminiLoading] = useState(false)
const [openaiLoading, setOpenaiLoading] = useState(false)
```

Note: because both are triggered in a single API call that uses `Promise.allSettled`, both will resolve together when the endpoint responds. Use a single `isLoading` boolean for the overall request, but show the skeleton cards for both models as soon as loading starts.

#### After submission — results state

Two cards side by side (or stacked on mobile), one for each model:

**Each result card contains:**
- Model label badge: `"Gemini"` (blue badge) or `"OpenAI"` (green badge)
- Generated image at full card width, click to open full-size preview
- Download button below the image — downloads the PNG with a meaningful filename like `raniwala-gemini-{timestamp}.png`
- If that model failed: show an error state card with the error message and a muted `"This model was unable to generate a result for this request."` message

**Below both cards:**
- Collapsible section: `"View prompt used"` — expands to show the full prompt string in a monospace text box
- `"Generate Again"` button — resets the result state but keeps the form values and uploaded image so the team can quickly re-run

---

### State management

```typescript
const [uploadedFile, setUploadedFile] = useState<File | null>(null)
const [result, setResult] = useState<MarketingVisualResponse | null>(null)
const [isLoading, setIsLoading] = useState(false)
const [promptVisible, setPromptVisible] = useState(false)
```

---

### onSubmit handler

1. If no `uploadedFile`, show toast error: `"Please upload a jewellery image first"` and return
2. Set `isLoading = true`, clear previous `result`
3. Call `generateMarketingVisual(uploadedFile, formValues)` from `lib/api.ts`
4. On success: set `result` with the response, scroll right column into view
5. On error: show toast with error message
6. Finally: set `isLoading = false`

---

### Mobile responsive behaviour

- On screens below `md` breakpoint: stack left and right columns vertically
- Result cards stack vertically on mobile (full width each)
- Upload preview is capped at 200px height on all screen sizes

---

## TASK 7 — Image pre-processing with Sharp (server/routes.ts)

Before sending the image to either AI model, pre-process it using Sharp to maximise generation quality:

```typescript
import sharp from 'sharp';

// Inside the route handler, after converting to base64:
const processedBuffer = await sharp(req.file.buffer)
  .resize(1024, 1024, {
    fit: 'inside',        // preserve aspect ratio
    withoutEnlargement: true  // don't upscale small images
  })
  .jpeg({ quality: 90 })
  .toBuffer();

const base64Image = processedBuffer.toString('base64');
```

This ensures:
- Images are not sent at unnecessarily large sizes (reduces token cost)
- Both models receive the same pre-processed input
- Consistent quality regardless of what the user uploads

---

## TASK 8 — Verify and type check

After all files are created and modified, run:

```bash
npm run check
```

Fix all TypeScript errors before considering the feature complete.

---

## Acceptance Criteria

- [ ] `/marketing` route accessible from the nav
- [ ] User can upload a jewellery product photo with drag-drop or click, preview it, and clear it
- [ ] All 7 parameter dropdowns render with correct options sourced from `MARKETING_FORM_OPTIONS`
- [ ] Submitting calls `POST /api/generate-marketing` with the image and all params
- [ ] Both Gemini and OpenAI run in parallel via `Promise.allSettled()`
- [ ] Both results are shown side by side with model label badges
- [ ] Each result card has a working download button
- [ ] If one model fails, the other result still shows — failure card shown for the failed model
- [ ] Full prompt is viewable in the collapsible section
- [ ] Generated images are saved to `designs/marketing/` on disk
- [ ] Project is saved to `design_projects` table in DB
- [ ] Image is pre-processed through Sharp before being sent to either model
- [ ] `npm run check` passes with zero TypeScript errors
- [ ] Page visually matches the Design Studio (`home.tsx`) style
- [ ] Mobile responsive — columns stack correctly on small screens

---

## Prompt Engineering Notes for Testing

When testing, these combinations tend to produce the best results. Use them to validate quality before the team starts using the feature:

**Best for necklaces:**
- Composition: `"Close-up portrait — face and neckline, jewellery focal"` or `"Half body — waist up"`
- Outfit: `"Minimal — bare shoulder / blouse focus (jewellery focal)"` or `"Heavy bridal lehenga — ivory / gold"`
- Lighting: `"Soft diffused"` or `"Golden hour"`

**Best for earrings:**
- Composition: `"Close-up portrait — face and neckline, jewellery focal"`
- Hair should be styled up or to one side — add this in custom notes

**Best for bangles / bracelets:**
- Composition: `"Detail close-up — extreme close on the jewellery piece"` or `"Half body"`
- Add in custom notes: `"Show wrists prominently, arms gracefully positioned"`

**CAD image inputs (white background):**
- Add to custom notes: `"The jewellery image has a white background — extract the jewellery and place it naturally on the model"`
- This helps both models handle transparent/white input images correctly
