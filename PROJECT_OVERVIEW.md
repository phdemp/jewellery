# Raniwala 1881 — Design Brain: Project Overview

> Developer reference document. Covers architecture, file structure, modules, API, DB schema, data flows, and constants.

---

## 1. Project Brief

**Design Brain** is an AI-powered jewellery design sketch generator built for **Raniwala 1881**, a luxury Indian jewellery house. Designers input structured parameters (category, theme, motifs, stones, material ratio) and the system generates a hand-drawn-style jewellery sketch using Google Gemini's image generation API.

The core intelligence comes from a **RAG (Retrieval-Augmented Generation)** pipeline: reference images uploaded by the team are analyzed by Gemini Vision, embedded into a 3072-dimensional vector space, and stored in PostgreSQL via the pgvector extension. At generation time, the system performs cosine similarity search to find the most relevant references and feeds their style analysis into the prompt, ensuring design outputs are consistent with the brand's visual language.

**Hosted on:** Replit (Express + Vite dev server on port 5000).

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + TypeScript | 19.x |
| **Build Tool** | Vite | 7.x |
| **Styling** | Tailwind CSS 4 + shadcn/ui | 4.x |
| **Routing** | Wouter | 3.x |
| **Forms** | React Hook Form + Zod | 7.x / 3.x |
| **Data Fetching** | TanStack React Query | 5.x |
| **Animations** | Framer Motion | 12.x |
| **Server** | Express.js + TypeScript | 4.x |
| **Database** | PostgreSQL + Drizzle ORM | drizzle 0.39 |
| **Vector Search** | pgvector extension | 3072-dim |
| **AI — Vision + Embeddings** | Google Gemini 2.5 Flash | `@google/genai` |
| **AI — Image Generation** | Google Gemini 2.5 Flash | `@google/genai` |
| **AI — Fallback** | OpenAI (optional) | `openai` 6.x |
| **Image Processing** | Sharp | 0.34.x |
| **File Upload** | Multer | 2.x |
| **Google Drive** | googleapis + google-auth-library | 148.x / 10.x |
| **Notifications** | Sonner | 2.x |

---

## 3. File Tree (Annotated)

```
jewellery-main/
│
├── client/                          # React SPA (Vite root)
│   ├── index.html                   # Entry HTML: fonts, title, favicon, OG meta
│   ├── public/
│   │   └── favicon.svg              # SVG favicon (Raniwala R mark)
│   └── src/
│       ├── main.tsx                 # React root mount + QueryClient provider
│       ├── App.tsx                  # Wouter router: maps paths to pages
│       ├── index.css                # Tailwind v4 @theme block: color palette, fonts
│       │
│       ├── pages/
│       │   ├── home.tsx             # Design Studio — main generation UI
│       │   ├── references.tsx       # Reference Library — upload/manage/embed refs
│       │   ├── comparison.tsx       # A/B comparison (with/without RAG)
│       │   └── not-found.tsx        # 404 fallback page
│       │
│       ├── components/
│       │   ├── layout.tsx           # App shell: RaniwalaLogo, nav, scroll header, footer
│       │   ├── design-form.tsx      # Main user input form (category/theme/motifs/etc.)
│       │   ├── result-display.tsx   # Generated sketch viewer + iteration controls
│       │   ├── ornamental-divider.tsx  # SVG decorative divider (amber/gold motif)
│       │   └── ui/                  # shadcn/ui component library (50+ files)
│       │
│       ├── hooks/
│       │   ├── use-mobile.tsx       # Media query hook for responsive behavior
│       │   └── use-toast.ts         # Sonner toast notification hook
│       │
│       └── lib/
│           ├── api.ts               # Typed fetch client for all server endpoints
│           ├── jewellery-logic.ts   # Domain constants + generateDesignLogic()
│           ├── queryClient.ts       # TanStack Query client configuration
│           └── utils.ts             # cn() (clsx + tailwind-merge), misc utilities
│
├── server/
│   ├── index.ts                     # Express app init: middleware, error handling, port 5000
│   ├── routes.ts                    # All API route handlers + BRAND_RULES constant
│   ├── google-client.ts             # Gemini API: vision analysis, embeddings, image gen
│   ├── google-drive.ts              # Google Drive folder listing + image download
│   ├── db.ts                        # Drizzle ORM + pg Pool connection
│   ├── storage.ts                   # DatabaseStorage class — CRUD for all tables
│   ├── vector-store.ts              # pgvector abstraction — add, search, migrate
│   ├── static.ts                    # Static file serving for production build
│   └── vite.ts                      # Vite dev middleware integration
│
├── shared/
│   └── schema.ts                    # DB table definitions + Zod validators (shared)
│
├── script/
│   └── build.ts                     # Custom esbuild script for production bundle
│
├── migrations/                      # Drizzle-generated SQL migration files
├── uploads/                         # Persisted reference image uploads (disk)
├── designs/                         # Saved generated designs (organized by category/theme)
├── data/
│   └── vectors.json                 # Legacy embedding data (for migration only)
│
├── PROJECT_OVERVIEW.md              # This file
├── package.json                     # Dependencies + npm scripts
├── tsconfig.json                    # TypeScript config with path aliases (@/, @shared/)
├── vite.config.ts                   # Vite config: React plugin, Tailwind, aliases
├── drizzle.config.ts                # Drizzle ORM: PostgreSQL dialect, schema path
├── postcss.config.js                # PostCSS for Tailwind CSS 4
├── components.json                  # shadcn/ui configuration
├── vite-plugin-meta-images.ts       # Custom Vite plugin for asset metadata
└── .env                             # Environment variables (not committed)
```

---

## 4. Module Descriptions

### `server/routes.ts`
The main API layer (~29KB). Registers all 14 HTTP endpoints on the Express app. Contains the **`BRAND_RULES`** constant — a detailed system prompt establishing the Raniwala 1881 aesthetic (hand-drawn style, polki stone rendering, pastel coloring, 2D drafting, no realism). Also configures two Multer instances: `diskStorage` (for reference image uploads to `uploads/`) and `memoryStorage` (for ephemeral style override files during generation).

### `server/google-client.ts`
Wraps the `@google/genai` SDK. Key exports:
- `analyzeReferenceImage(base64)` — uses Gemini Vision to extract description, motifs, style elements, line style, gemstone rendering, and coloring technique from a reference image
- `generateTextEmbedding(text)` — generates a 3072-dim vector from a text description
- `generateImageEmbedding(base64)` — generates a 3072-dim vector directly from an image
- `generateJewellerySketch(prompt, contextImages?)` — calls Gemini 2.5 Flash image gen, returns base64 PNG
- `editJewellerySketch(sourceImageBase64, editPrompt)` — edits an existing sketch image
- `buildDesignContext(params, similarDesigns)` — assembles the full text prompt from design params + RAG results
- `buildImagePrompt(context)` — formats the final image generation prompt string

### `server/vector-store.ts`
Abstracts pgvector operations. Stores 3072-dim embedding vectors in the `reference_images.embedding_vector` column.
- `addVector(id, vector, metadata)` — inserts or updates an embedding
- `searchSimilarVectors(queryVector, topK, themeCode?)` — performs cosine similarity search (`<=>` operator), optionally filtered by theme code
- `getAllVectors()` — returns all stored vectors (for re-embedding workflows)
- `clearVectorStore()` — truncates vector data
- `migrateJsonToVector(entries)` — migrates legacy JSONB embeddings to the pgvector column

### `server/storage.ts`
`DatabaseStorage` class providing typed CRUD operations over Drizzle ORM:
- `createReferenceImage()`, `getReferenceImages()`, `getReferenceImage(id)`, `deleteReferenceImage(id)` — reference management
- `createDesignProject()`, `getDesignProjects()`, `getDesignProject(id)`, `updateDesignProject()` — design project lifecycle
- `createDesignIteration()`, `getDesignIterations(projectId)` — edit history

### `server/google-drive.ts`
Google Drive integration for bulk reference import:
- `extractFolderId(url)` — parses a Drive folder URL to extract the folder ID
- `listImagesInFolder(folderId)` — lists all image files in a Drive folder using the Drive API
- `downloadImage(fileId)` — downloads a file as a Buffer using Drive API

### `shared/schema.ts`
Single source of truth for data shape — used by both Drizzle ORM (server) and Zod (client validation). Defines 3 database tables and exports Zod insert schemas, TypeScript types, and the `THEME_CODES` constant array. Uses a custom `vector(3072)` Drizzle type for the pgvector column.

### `client/src/lib/api.ts`
Typed fetch wrappers for every server endpoint. Uses `FormData` for file uploads and `multipart/form-data` where needed. Re-exports `THEME_CODES` from shared schema. Key functions: `uploadReferenceImage()`, `getReferenceImages()`, `deleteReferenceImage()`, `generateDesign()`, `generateComparison()`, `importFromDrive()`, `reembedAllReferences()`.

### `client/src/lib/jewellery-logic.ts`
Domain constants and the `generateDesignLogic()` helper (legacy prompt builder, partially superseded by server-side RAG). Key exports: `CATEGORIES`, `THEME_OPTIONS`, `MOTIF_GROUPS`, `MOTIFS`, `MATERIAL_RATIOS` (mapped to price-range prompt values via `PRICE_RANGE_OPTIONS`), `STONES`, `STYLE_RULES`.

### `client/src/pages/home.tsx`
The Design Studio — the app's primary page. Left column: `DesignForm` for parameter input. Right column: `ResultDisplay` showing the generated sketch, sketch plan text, prompt details, and iteration history. Includes a hero tagline strip and ornamental divider above the grid.

### `client/src/pages/references.tsx`
Reference Library management UI with tabs (by theme), search/filter, upload dialog (multi-file with theme selection), Google Drive import dialog, and a grid of reference cards. Provides re-embed workflow and per-reference delete. Clicking a card opens a detail modal with vision analysis metadata.

### `client/src/pages/comparison.tsx`
A/B test page (commented out of nav but accessible at `/comparison`). Runs `POST /api/generate-comparison` with the same parameters and displays two side-by-side results: one generated with RAG references, one without — useful for evaluating reference quality.

### `client/src/components/design-form.tsx`
The main input form. Fields: category (select), theme (select), motifs (multi-checkbox grouped by category), stones (multi-checkbox), material ratio / price range (radio), custom notes (textarea), and an optional style override image upload. Submits via `onSubmit(data, styleOverrideFile?)`.

### `client/src/components/result-display.tsx`
Displays the generated result: a full-size sketch image with download option, the text sketch plan (formatted markdown), the image prompt used, reference images that contributed to the design, and iteration controls (edit prompt input + submit).

### `client/src/components/layout.tsx`
App shell with `RaniwalaLogo` (text-based heritage mark), scroll-aware header (shadow/border appear after 20px scroll), navigation links, decorative background blobs, and a footer with `OrnamentalDivider` + tagline.

---

## 5. API Endpoint Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/reference-images` | Upload reference image(s) — runs Gemini Vision analysis + generates 3072-dim pgvector embedding + creates 300px thumbnail. Body: `multipart/form-data` with `file` + optional `themeCode`. |
| `GET` | `/api/reference-images` | List all reference images (excludes `embeddingVector` for performance). Returns array of `ReferenceImage`. |
| `DELETE` | `/api/reference-images/:id` | Delete reference image record + disk files (original + thumbnail). |
| `POST` | `/api/generate-design` | Generate jewellery sketch. Body: design params (category, theme, motifs, stones, materialRatio, customNotes) + optional `styleOverride` file. RAG pipeline: embed query → cosine search → Gemini Vision on top-3 refs → build prompt → Gemini image gen. Returns `{ projectId, imageUrl, sketchPlan, imagePrompt, usedReferences }`. |
| `POST` | `/api/generate-comparison` | Same as above but runs both with-RAG and without-RAG generations in parallel. Returns `{ withReferences: {...}, withoutReferences: {...} }`. |
| `GET` | `/api/design-projects` | List all saved design projects. |
| `GET` | `/api/design-projects/:id` | Fetch single design project with full details. |
| `POST` | `/api/design-projects/:id/edit` | Submit an edit prompt for an existing design. Retrieves latest iteration image (or original), calls `editJewellerySketch()`, saves new iteration. Body: `{ editPrompt: string }`. |
| `GET` | `/api/design-projects/:id/iterations` | Get iteration history (ordered by `iterationNumber`). |
| `POST` | `/api/design-projects/:id/save` | Save generated image to `designs/{category}/{theme}/{timestamp}.png` on disk. |
| `POST` | `/api/import-from-drive` | Bulk import from Google Drive folder. Body: `{ folderUrl, themeCode? }`. Lists images, downloads each, runs Vision + embedding pipeline. Returns `{ imported, skipped, errors }`. |
| `POST` | `/api/reembed-references` | Re-analyze all reference images with enhanced Vision prompt + regenerate embeddings. Useful after model/prompt changes. Returns per-image success/error. |
| `POST` | `/api/migrate-vectors` | One-time migration: copies embeddings from legacy JSONB `embedding` column to the `embedding_vector` pgvector column. |
| `POST` | `/api/generate-thumbnails` | Generates missing 300px JPEG thumbnails for existing reference images using Sharp. |

---

## 6. Database Schema

### `reference_images`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `varchar` PK | UUID, auto-generated |
| `filename` | `text` NOT NULL | Original uploaded filename |
| `filepath` | `text` NOT NULL | Absolute path on disk (in `uploads/`) |
| `thumbnail_path` | `text` | Path to 300×300 JPEG thumbnail |
| `theme_code` | `text` | One of the 9 theme codes (WRD, WRO, etc.) |
| `uploaded_at` | `timestamp` | Auto-set on insert |
| `metadata` | `jsonb` | `VisionAnalysisResult`: description, styleElements, motifs, structure, lineStyle, coloringTechnique, gemstoneRendering, etc. |
| `embedding` | `jsonb` | Legacy: embedding as JSON array (pre-migration) |
| `embedding_vector` | `vector(3072)` | pgvector column — cosine similarity search target |

### `design_projects`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `varchar` PK | UUID |
| `category` | `text` NOT NULL | e.g. "Long Necklace Set", "Ring" |
| `theme` | `text` NOT NULL | e.g. "Bridal Premium" |
| `motifs` | `text[]` NOT NULL | Selected motif names |
| `stones` | `text[]` | Selected stone names |
| `material_ratio` | `text` NOT NULL | e.g. "Up to 8 Lakhs" |
| `custom_notes` | `text` | Free-text user notes |
| `reference_image_ids` | `text[]` | IDs of reference images used for this generation |
| `sketch_plan` | `text` | Verbose design plan text (displayed in UI) |
| `image_prompt` | `text` | Final prompt string sent to Gemini image gen |
| `generated_image_url` | `text` | URL path to generated PNG |
| `created_at` | `timestamp` | Auto-set on insert |

### `design_iterations`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `varchar` PK | UUID |
| `design_project_id` | `varchar` FK | References `design_projects.id` |
| `iteration_number` | `integer` NOT NULL | Sequential edit number (1, 2, 3…) |
| `edit_prompt` | `text` NOT NULL | User's edit instruction |
| `source_image_url` | `text` NOT NULL | Input image URL for this edit |
| `result_image_url` | `text` NOT NULL | Output image URL |
| `created_at` | `timestamp` | Auto-set on insert |

### Theme Codes
| Code | Display Name |
|------|-------------|
| `WRD` | Wearable Daily |
| `WRO` | Wearable Occasional |
| `CLO` | Collectable Occasional |
| `SOD` | Solitaire Daily |
| `SOO` | Solitaire Occasional |
| `SOP` | Solitaire Premium |
| `BRC` | Bridal Classic |
| `BRP` | Bridal Premium |
| `BRU` | Bridal Unique |

---

## 7. Data Flow Diagrams

### Design Generation (RAG Pipeline)
```
User Input (category, theme, motifs, stones, materialRatio, customNotes)
        │
        ▼
[Optional: styleOverride image upload → memoryStorage]
        │
        ▼
POST /api/generate-design
        │
        ├─ If styleOverride: encode to base64, use directly as context image
        │
        └─ Otherwise (RAG path):
              │
              ▼
         generateTextEmbedding(designParams as text)
              │  [Gemini embeddings API, 3072-dim]
              ▼
         searchSimilarVectors(queryVector, topK=3, themeCode?)
              │  [pgvector cosine similarity <=>]
              ▼
         Load top-3 referenceImages from DB
              │
              ▼
         analyzeReferenceImage(each) → VisionAnalysisResult[]
              │  [Gemini Vision, cached in metadata column]
              ▼
         buildDesignContext(params, similarDesigns)
         buildImagePrompt(context) + BRAND_RULES prepended
              │
              ▼
         generateJewellerySketch(fullPrompt)
              │  [Gemini 2.5 Flash image gen, returns base64 PNG]
              ▼
         Save PNG to disk, createDesignProject in DB
              │
              ▼
         Response: { projectId, imageUrl, sketchPlan, imagePrompt, usedReferences }
              │
              ▼
         Client: ResultDisplay renders image + sketch plan
```

### Reference Image Upload
```
File(s) selected by user
        │
        ▼
POST /api/reference-images  (multipart/form-data)
        │
        ▼
Multer diskStorage → saves to uploads/{timestamp}-{random}.jpg
        │
        ▼
Read file → encode to base64
        │
        ├─────────────────────────────────┐
        ▼                                 ▼
analyzeReferenceImage(base64)     generateImageEmbedding(base64)
[Gemini Vision → VisionAnalysisResult]   [Gemini Embeddings → number[3072]]
        │                                 │
        └──────────────┬──────────────────┘
                       ▼
              Sharp → resize to 300×300 JPEG thumbnail → thumbnailPath
                       │
                       ▼
              createReferenceImage(DB) + addVector(pgvector)
                       │
                       ▼
              Response: saved ReferenceImage object
                       │
                       ▼
              Client: Reference Library grid updates
```

---

## 8. Key Constants & Business Logic

### Categories (16)
```
Long Necklace Set, Choker, Necklace, Bangle, Hathphool, Bracelet, Ring,
Kantha, Brooch, Kalangi, Ear Extensions, Maangtika, Sheesh Patti,
Buttons, Nath, Lapel Pin
```

### Motif Groups
| Group | Motifs |
|-------|--------|
| Nature-Inspired | Lotus, Paan, Paisley, Leaves, Cluster Flowers |
| Animal & Birds | Swan, Parrot, Peacock, Elephant, Butterfly |
| Contemporary Luxury | Art Deco, Scallop, Ribbons, Jaali Pattern |
| Forms & Shapes | Geometric, Ovals, Marquise, Domes & Arches, Curves, Pears |
| Celestial & Spiritual | Crescent Moon, Om, Kalash |

> **Note:** Animal & Birds motifs are blocked for CLO (Collectable Occasional) theme by design validation logic.

### Material Ratios / Price Range
| Display | Prompt Value |
|---------|-------------|
| Up to 8 Lakhs | Polki-filled design with gold as thin bezels only |
| 15+ Lakhs | Dense polki coverage with intricate kundan work, gold visible only as fine bezels |

### Stones (7)
```
Polki, Emerald, Rubies, Sapphires, Pink Tourmaline, Navratna, Amethyst
```

### BRAND_RULES (server/routes.ts)
A multi-paragraph system prompt constant injected at the start of every Gemini image generation call. Establishes:
- Hand-drawn sketch aesthetic (thin pencil outlines in soft brown/gold)
- Polki stone rendering (soft white rounded bubbles)
- Gemstone shading (pastel, colored-pencil, smooth gradients)
- 2D frontal drafting style — no realism, no shadows, no black outlines
- White/beige sketch-paper background
- Category-specific layout rules (necklace symmetry, ring proportion, etc.)
- Theme-specific design constraints (WRD = lightweight, BRP = maximum coverage, etc.)

---

## 9. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Must have pgvector extension installed. |
| `GEMINI_API_KEY` | Yes | Google AI Studio API key for Gemini 2.5 Flash (Vision, Embeddings, Image Gen). |
| `GOOGLE_CLOUD_PROJECT_ID` | Yes | GCP project ID (used for Vertex AI / Google Cloud APIs). |
| `SESSION_SECRET` | Recommended | Express session secret. |
| `OPENAI_API_KEY` | Optional | OpenAI API key — fallback AI provider, not used in primary flow. |

---

## 10. NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `cross-env NODE_ENV=development tsx --env-file=.env server/index.ts` | Start full-stack dev server. Express serves Vite dev middleware on port 5000. |
| `npm run dev:client` | `vite dev --port 5000` | Frontend only (no backend). |
| `npm run build` | `tsx script/build.ts` | Production build: Vite bundles client to `dist/public/`, esbuild bundles server to `dist/index.cjs`. |
| `npm run start` | `cross-env NODE_ENV=production node dist/index.cjs` | Run production bundle. |
| `npm run check` | `tsc` | TypeScript type check (no emit). |
| `npm run db:push` | `drizzle-kit push` | Push schema changes directly to the database (dev use only). |
