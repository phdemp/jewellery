# TODO: Design Modifier Feature

> Feed this file to Claude Code with: `claude -p TODO.md`
> All tasks are self-contained and ordered by dependency. Complete them top to bottom.

---

## Overview

Build a new `/modify` page where users upload an existing jewellery image, select design parameters, and have Gemini edit the image. Results are saved as a `design_project` with full iteration support.

**Files to create:** `client/src/pages/modify.tsx`
**Files to modify:** `client/src/App.tsx`, `client/src/components/layout.tsx`, `client/src/lib/api.ts`, `server/routes.ts`
**Files to leave untouched:** `server/google-client.ts`, `server/storage.ts`, `server/vector-store.ts`, `server/db.ts`, `shared/schema.ts`

---

## Tasks

### TASK 1 — Add types and API function to `client/src/lib/api.ts`

Add the following TypeScript interfaces and fetch function.

**Types to add:**
```typescript
export interface ModifyDesignParams {
  productSegment?: string;
  category?: string;
  priceBand?: string;
  polkiSize?: string;
  motifCategory?: string;
  motifs?: string[];
  stoneColour?: string[];
  enamel?: string;
  finish?: string;
  designShape?: string;
  materialRatio?: string;
  talaf?: string;
  piroiPlacement?: string;
  piroiColour?: string;
  customNotes?: string;
}

export interface ModifyDesignResponse {
  projectId: string;
  imageUrl: string;
  sketchPlan: string;
  imagePrompt: string;
}

// Cascading dropdown data structure
export interface SegmentCategoryMap {
  [segment: string]: {
    category: string;
    price_bands: string[];
  }[];
}
```

**Also add this constant** (used by the form for cascading dropdowns):
```typescript
export const SEGMENT_CATEGORY_PRICE_MAP: SegmentCategoryMap = {
  "Bridal": [
    { category: "Necklace / Necklace Set", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Choker / Choker Set", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Pendant (with piroi) / Long Pendant Set (with piroi)", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] },
    { category: "Long Necklace (without piroi) / Long Necklace Set (without piroi)", price_bands: ["25-50 Lakh", "50 Lakh - 1Cr"] }
  ],
  "Bridal Lite": [
    { category: "Necklace / Necklace Set", price_bands: ["15-25 Lakh"] },
    { category: "Choker / Choker Set", price_bands: ["15-25 Lakh"] },
    { category: "Long Pendant (with piroi) / Long Pendant Set (with piroi)", price_bands: ["15-25 Lakh"] },
    { category: "Long Necklace (without piroi) / Long Necklace Set (without piroi)", price_bands: ["15-25 Lakh"] }
  ],
  "Traditional": [
    { category: "Necklace / Necklace Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] },
    { category: "Choker / Choker Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] }
  ],
  "Modern": [
    { category: "Necklace / Necklace Set", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh", "25-50 Lakh", "50 Lakh - 1Cr"] }
  ],
  "Ready to Wear (RTW)": [
    { category: "Chain Necklace / Chain Necklace Set", price_bands: ["0-5 Lakh"] },
    { category: "Pendant / Pendant Set", price_bands: ["0-5 Lakh"] }
  ],
  "Ear Essentials": [
    { category: "Earrings", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh"] }
  ],
  "Hand-wear": [
    { category: "Bangles", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh", "15-25 Lakh"] },
    { category: "Bracelet", price_bands: ["0-5 Lakh", "5-10 Lakh", "10-15 Lakh"] }
  ],
  "Add-ons": [
    { category: "Nosepin/Nath", price_bands: ["0-5 Lakh"] },
    { category: "Mangtika", price_bands: ["0-5 Lakh"] }
  ]
};
```

**Function to add:**
```typescript
export async function modifyDesign(
  imageFile: File,
  params: ModifyDesignParams
): Promise<ModifyDesignResponse>
```

Implementation notes:
- Use `FormData`
- Append the image file with key `"image"`
- Append each param individually; for array fields (`motifs`, `stoneColour`) use `JSON.stringify()` before appending
- Skip appending any param that is undefined or empty
- POST to `/api/modify-design`
- Throw an error if response is not ok

---

### TASK 2 — Add `POST /api/modify-design` endpoint to `server/routes.ts`

Register this route **before** the wildcard static file handler at the bottom of the file.

**Multer:** Use the existing `memStorage` / `memUpload` instance already declared in the file. Do not create a new Multer instance.

**Request shape (multipart/form-data):**
- `image` — file (required)
- `productSegment`, `category`, `priceBand`, `polkiSize`, `motifCategory`, `finish`, `designShape`, `materialRatio`, `talaf`, `piroiPlacement`, `piroiColour`, `enamel`, `customNotes` — optional strings
- `motifs`, `stoneColour` — optional JSON-stringified string arrays

**Handler logic:**
1. If `req.file` is missing, return `400 { error: "Image file is required" }`
2. Convert `req.file.buffer` to base64 string
3. Parse `motifs` and `stoneColour` from JSON strings (wrap in try/catch, default to `[]`)
4. Build `editPrompt` string — only include lines for parameters that have a non-empty value:

```
Modify this jewellery design according to the following specifications:

[include only non-empty fields, one per line, e.g.]
Product Segment: Bridal
Category: Necklace / Necklace Set
Price Band: 25-50 Lakh
Polki Size: Big
Motif Category: Nature - Inspired
Motifs: Lotus, Paan
Stone Colours: Red Stone, Green Stone
Enamel: Yes
Finish: Dark Antique
Design Shape: Classic Choker
Material Ratio: Polki Intensive
Talaf: Talaf-Red
Piroi Placement: Top
Piroi Colour: Red

Additional Instructions: [customNotes if provided]

Maintain the hand-drawn sketch aesthetic, polki stone rendering style, pastel coloring, and 2D frontal drafting approach. Apply the specified parameters to reimagine the design while preserving the brand's visual language.
```

5. Call `editJewellerySketch(sourceImageBase64, editPrompt)` — already imported from `./google-client`
6. Decode the returned base64 PNG and save to disk at `designs/modifications/{Date.now()}.png` — create the directory if it doesn't exist
7. Call `storage.createDesignProject()` with:
   - `category`: selected category or `"Modification"`
   - `theme`: selected productSegment or `"Custom"`
   - `motifs`: parsed motifs array
   - `stones`: parsed stoneColour array
   - `materialRatio`: materialRatio or `""`
   - `customNotes`: customNotes or `""`
   - `sketchPlan`: the editPrompt string
   - `imagePrompt`: the editPrompt string
   - `generatedImageUrl`: `/designs/modifications/{filename}`
8. Return `{ projectId: project.id, imageUrl, sketchPlan: editPrompt, imagePrompt: editPrompt }`
9. Wrap everything in try/catch — return `500 { error: err.message }` on failure

---

### TASK 3 — Add route in `client/src/App.tsx`

Import the new page and register the route with Wouter:

```tsx
import ModifyPage from "@/pages/modify";

// Inside the Switch block, add:
<Route path="/modify" component={ModifyPage} />
```

---

### TASK 4 — Add nav link in `client/src/components/layout.tsx`

In the navigation section alongside the existing "Design Studio" and "References" links, add:

```tsx
<Link href="/modify">Design Modifier</Link>
```

Match the exact className/styling of the existing nav links.

---

### TASK 5 — Create `client/src/pages/modify.tsx`

Build the full page. Match the visual language of `home.tsx` exactly.

#### Page structure
- Hero tagline strip at the top (same style as Design Studio page)
- `OrnamentalDivider` below the hero strip
- Two-column grid below: left = upload + form, right = result

#### Left column — Part A: Image Upload Panel

- Dashed amber/gold border upload zone
- Click to browse OR drag-and-drop
- On file select: show image preview, filename, file size
- Show a remove/clear button to reset the selection
- Accepted file types: `image/jpeg`, `image/png`, `image/webp`
- Store the file in local `useState`

#### Left column — Part B: Parameter Form

Use **React Hook Form + Zod**. All fields optional except the image file.

##### Cascading Dropdowns — Segment → Category → Price Band

Import `SEGMENT_CATEGORY_PRICE_MAP` from `lib/api.ts`.

Implement the first three fields as **controlled cascading selects**:

**Product Segment** — `<Select>` (single)
- Options: the top-level keys of `SEGMENT_CATEGORY_PRICE_MAP`
- On change: reset `category` and `priceBand` fields to `""`

**Category** — `<Select>` (single)
- Disabled until a Segment is selected
- Options: derived from `SEGMENT_CATEGORY_PRICE_MAP[selectedSegment]` — show each entry's `category` string
- On change: reset `priceBand` field to `""`

**Price Band** — `<Select>` (single)
- Disabled until a Category is selected
- Options: derived from the matching entry in `SEGMENT_CATEGORY_PRICE_MAP[selectedSegment]` where `entry.category === selectedCategory`
- Shows only the price bands that actually exist for that segment + category combination

Use `watch(["productSegment", "category"])` from React Hook Form to reactively derive the available options for Category and Price Band.

**Polki Size** — `<Select>` (single)
Options: `Far`, `Big`, `Normal`

**Motif Category** — `<Select>` (single)
Options: `Animal & Bird`, `Celestial & Spiritual`, `Contemporary Luxury`, `Forms & Shapes`, `Nature - Inspired`, `Multiple Choice`, `No Motifs`

**Motifs** — multi-select checkboxes, grouped by Motif Category
```
Animal & Bird:         Bird, Horse, Parrot, Peacock, Elephant, Butterfly, Tiger/Panther, Swan, Lion
Celestial & Spiritual: Sun, Crescent Moon, Stars
Contemporary Luxury:   Art Deco, Victorian Art, Scallop, Ribbons
Forms & Shapes:        Domes & Arches, Geometric, Abstract, Asymmetrical, Ovals, Marquise, Pears, Curves, Jaali Patterns
Nature - Inspired:     Lotus, Rose, Tulip, Paan, Paisley, Leaves, Cluster Flowers
```

**Stone Colour** — multi-select checkboxes
Options: `Red Stone`, `Green Stone`, `Blue Stone`, `Pink Stone`, `White Stone`, `Coral Stone`, `Multicolour Stone`, `Navratna Stone`, `Violet Stone`, `Yellow Stone`

**Enamel** — radio buttons: `Yes` / `No`

**Finish** — `<Select>` (single)
Options: `Yellow Gold Finish`, `Light Antique`, `Dark Antique`, `Matte`, `Hammered`, `Dual Tone`, `White Rhodium`, `Rose Gold Finish`

**Design Shape** — `<Select>` (single)
Options: `Classic Choker`, `Dog Band Choker`, `Choker With Jhaalar`, `Semi Chokar`, `T-Shape`, `Round`, `Oval`, `Studs`, `Drops`, `Hoops`, `Earcuff`, `Basic`, `U-Shape`, `Y-Shape`, `V-Shape`, `Layered`, `Hasli`

**Material Ratio** — `<Select>` (single)
Options: `Polki Intensive`, `Diamond Intensive`, `Stone Intensive`, `Gold Intensive`, `Piroi Intensive`

**Talaf** — `<Select>` (single, optional)
Options: `None`, `Talaf-Red`, `Talaf-Green`, `Talaf-Blue`, `Talaf-Pink`

**Piroi Placement** — `<Select>` (single, optional)
Options: `None`, `Top`, `Front`, `Back`, `Latkan`

**Piroi Colour** — `<Select>` (single, optional)
Options: `None`, `Red`, `Green`, `Blue`, `White`, `Pink`

**Custom Notes** — `<Textarea>`
Placeholder: `"Add any extra instructions, specific details, or modifications you want..."`

**Submit button** — label: `"Modify Design"`
- Disabled when no image is uploaded or when `isLoading` is true
- Show a spinner icon when loading

#### Right column — Result display

- Before submission: show an elegant empty state (ornamental placeholder, short brand tagline)
- After submission: render the `<ResultDisplay>` component, passing `projectId`, `imageUrl`, `sketchPlan`, `imagePrompt`
- On error: show a toast notification using the existing toast hook

#### State management
```typescript
const [uploadedFile, setUploadedFile] = useState<File | null>(null)
const [result, setResult] = useState<ModifyDesignResponse | null>(null)
const [isLoading, setIsLoading] = useState(false)
```

#### onSubmit handler
1. If no `uploadedFile`, show toast error and return
2. Set `isLoading = true`
3. Map form values to `ModifyDesignParams` (convert `"None"` select values to `undefined`)
4. Call `modifyDesign(uploadedFile, params)` from `lib/api.ts`
5. On success: set `result`, scroll right column into view
6. On error: show toast with error message
7. Finally: set `isLoading = false`

---

### TASK 6 — Verify and run type check

After all files are created/modified, run:

```bash
npm run check
```

Fix any TypeScript errors before considering the feature complete.

---

## Acceptance Criteria

- [ ] `/modify` route is accessible from the nav
- [ ] User can upload an image (drag-drop or click), preview it, and clear it
- [ ] Selecting a Segment populates the Category dropdown with only valid options
- [ ] Selecting a Category populates the Price Band dropdown with only valid options for that segment + category
- [ ] Changing Segment resets Category and Price Band
- [ ] Changing Category resets Price Band
- [ ] All remaining parameter fields render with correct options
- [ ] Form submits to `POST /api/modify-design` with the image and all selected params including `priceBand`
- [ ] Gemini returns a modified image — displayed in the right column via `ResultDisplay`
- [ ] Result is saved to DB as a `design_project` (verify via `GET /api/design-projects`)
- [ ] Iteration editing works on the result (reuses existing edit flow)
- [ ] `npm run check` passes with zero errors
- [ ] Page visually matches the Design Studio (`home.tsx`) style
