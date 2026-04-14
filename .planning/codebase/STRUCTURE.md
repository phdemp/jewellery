# Codebase Structure

**Analysis Date:** 2025-04-14

## Directory Layout

```
jewellery-main/
├── client/                          # React SPA (Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx                  # Router + providers (Wouter, Query, Sentry, Tooltip)
│   │   ├── main.tsx                 # React root entry point
│   │   ├── index.css                # Tailwind CSS + custom properties
│   │   ├── pages/                   # One .tsx per route (7 pages)
│   │   ├── components/              # Reusable React components
│   │   ├── hooks/                   # Custom hooks (2)
│   │   └── lib/                     # Utility libraries (4 files)
│   ├── index.html                   # HTML template
│   └── public/                      # Static assets (SVGs, icons)
│
├── server/                          # Express API (TypeScript)
│   ├── index.ts                     # App init + port listener
│   ├── routes.ts                    # All 18 API endpoints (2523 lines)
│   ├── google-client.ts             # Gemini 2.5 + 3 Pro Image API wrappers
│   ├── openai-client.ts             # OpenAI gpt-image-1 API wrappers
│   ├── grok-client.ts               # xAI Grok API wrappers
│   ├── storage.ts                   # DatabaseStorage (DAO pattern)
│   ├── db.ts                        # Drizzle ORM + PostgreSQL pool
│   ├── vector-store.ts              # pgvector search functions
│   ├── costing.ts                   # Design costing calculations
│   ├── google-drive.ts              # Google Drive API wrapper
│   ├── stock-vector-store.ts        # Stock item vector search (not active)
│   ├── static.ts                    # Static file serving config
│   ├── vite.ts                      # Vite dev middleware
│   └── [no-modify zone]
│
├── shared/                          # Shared TypeScript types + Zod schemas
│   └── schema.ts                    # 6 Drizzle tables + Zod validators
│
├── .planning/                       # GSD planning artifacts (optional)
│   └── codebase/                    # Generated architecture docs
│
├── uploads/                         # Generated at runtime (disk storage)
│   ├── {timestamp}-{random}.jpg     # Reference image uploads
│   ├── thumb_{timestamp}.jpg        # 300x300 thumbnails
│   ├── generated_{timestamp}.png    # Gemini-generated sketches
│   ├── cad_{timestamp}.png          # OpenAI CAD renders
│   └── grok_{timestamp}.png         # Grok outputs
│
├── designs/                         # Generated at runtime (organized saves)
│   └── {category}/{theme}/{timestamp}.png
│
├── package.json                     # Workspace dependencies
├── tsconfig.json                    # TypeScript config (path aliases: @ → client/src)
├── vite.config.ts                   # Vite build + dev config
├── drizzle.config.ts                # Drizzle ORM migrations
├── CLAUDE.md                        # Project-level instructions
└── .env                             # Environment variables (gitignored)
```

---

## Directory Purposes

### `client/src/`
- **Purpose:** React 19 SPA with TypeScript
- **Contains:** 7 page components, 15+ UI/layout components, form logic, API client
- **Key files:** `App.tsx` (router), `pages/home.tsx` (main design studio), `components/design-form.tsx` (input form), `components/result-display.tsx` (output viewer)

### `client/src/pages/`
- **Purpose:** One route handler per page (7 total)
- **Contains:**
  - `home.tsx` — Design Studio (main generation page, uses DesignForm + ResultDisplay)
  - `references.tsx` — Reference Library (upload, grid, delete reference images)
  - `comparison.tsx` — Design Comparison (RAG vs no-RAG side-by-side)
  - `modify.tsx` — Design Modifier (upload image, edit with parameters, show costing)
  - `cad-comparison.tsx` — CAD Comparison (3-model CAD render grid)
  - `marketing.tsx` — Marketing Visuals (generate styled visuals for campaigns)
  - `assortment.tsx` — Assortment Planning (B2C sales analysis, stock recommendations)
  - `not-found.tsx` — 404 fallback

### `client/src/components/`
- **Purpose:** Reusable React components
- **Key domain components:**
  - `design-form.tsx` (150+ lines) — Form with cascaded dropdowns (Product Segment → Category → Price Band), multi-checkbox fields (Motifs, Stones), sliders (Gold %), pickers
  - `result-display.tsx` (200+ lines) — Image viewer, tabs (sketch plan, prompt, iterations), edit/save controls, iteration carousel
  - `cost-report.tsx` — Display costing breakdown (gold grams, stone counts, line items)
  - `multi-model-result.tsx` — 3-card grid showing Gemini/OpenAI/Grok results
  - `layout.tsx` (123 lines) — App shell: sticky header with logo + nav, decorative gradients, footer
  - `ornamental-divider.tsx` — SVG decorative divider (reused throughout)
- **UI components:** `ui/` subdir contains shadcn/ui primitives (do not modify)

### `client/src/hooks/`
- **Purpose:** Custom React hooks
- **Contains:**
  - `use-mobile.tsx` — Responsive breakpoint detection (Tailwind `lg:` = 1024px)
  - `use-toast.ts` — Sonner toast notification hook

### `client/src/lib/`
- **Purpose:** Utility libraries and client-side constants
- **Key files:**
  - `api.ts` (620+ lines) — 13+ typed fetch wrappers + interfaces (DesignGenerationResponse, CostingReportData, etc.) + shared stone/gold constants
  - `jewellery-logic.ts` (100+ lines) — Domain constants (CATEGORIES, THEMES, MOTIF_GROUPS, STONES, STYLE_INSPIRATIONS, PRICE_RANGES, etc.)
  - `queryClient.ts` (15 lines) — TanStack React Query configuration
  - `utils.ts` (1 line) — `cn()` function (clsx + tailwind-merge for conditional CSS)

### `server/`
- **Purpose:** Express.js API server with TypeScript
- **Contains:** 18 endpoints, 3 AI clients, storage layer, vector search, file upload handlers

### `server/routes.ts`
- **Purpose:** All API endpoints + business logic (2523 lines)
- **Key sections:**
  - Style inspirations descriptions (16 styles: Cartier, Bvlgari, Sabyasachi, etc.)
  - Multer config (diskStorage for uploads, memoryStorage for processing)
  - Design image filename parsing (THEME_CODES, PIECE_TYPE_SUFFIX_MAP)
  - 18 endpoints (POST /api/reference-images, GET /api/reference-images, DELETE, POST /api/generate-design, etc.)
  - Helper functions: `firstSuccessfulUrl()`, `toModelResult()`, `buildCADPromptJSON()`, `buildImagePromptJSON()`, `proxyDriveUrl()`, `parseTransPrice()`, etc.
  - BRAND_RULES (prepended to all generation prompts)
  - CAD_RULES (technical CAD rendering guidelines)
  - In-memory design import job state + batch processing logic
  - Static file wildcard handler (catch-all at end)

### `server/google-client.ts`
- **Purpose:** Gemini 2.5 Flash + Gemini 3 Pro Image API wrappers (44k bytes)
- **14 Functions:**
  - `analyzeReferenceImage()` — Vision API → VisionAnalysisResult
  - `generateTextEmbedding()` — Text → 3072-dim vector
  - `generateImageEmbedding()` — Image → 3072-dim vector (via analysis description)
  - `buildDesignContext()` — Pure function, combine params + similar designs
  - `buildImagePromptJSON()` — Generate JSON-structured prompt (active)
  - `buildImagePromptLegacy()` — Old prose prompt (kept, not used)
  - `generateJewellerySketch()` — Prompt → PNG (3-min timeout, retried)
  - `editJewellerySketch()` — Edit existing image → PNG
  - `modifyJewelleryImage()` — Modify image with params → PNG
  - `analyzeImageStyle()` — Vision → style description (30s timeout)
  - `buildMarketingPrompt()` — Build marketing context prompt
  - `generateMarketingVisualGemini()` — Generate styled visual → PNG
  - `analyzeDesignMaterials()` — Vision → material breakdown (gold %, polki, stones)
  - `analyzeImageForStoneLocations()` — Vision → stone positions for labeling

### `server/openai-client.ts`
- **Purpose:** OpenAI gpt-image-1 wrappers (3 functions)
- **3 Functions:**
  - `generateCADImageWithOpenAI()` — CAD render generation
  - `generateMarketingVisualOpenAI()` — Marketing visual generation
  - `modifyImageWithOpenAI()` — Image edit operation
- **Status:** Currently hitting billing hard limit (all calls return 400)

### `server/grok-client.ts`
- **Purpose:** xAI Grok API wrappers (6k bytes, 3 functions)
- **3 Functions:**
  - `generateImageWithGrok()` — Generate image from text
  - `modifyImageWithGrok()` — Edit existing image (uses JSON body, not multipart)
  - `generateMarketingVisualGrok()` — Generate styled visual
- **Note:** Uses raw `fetch` for edits because Grok requires JSON body; OpenAI SDK forces multipart

### `server/storage.ts`
- **Purpose:** Data Access Object (DAO) pattern — all DB operations (12 methods on DatabaseStorage class)
- **Key methods:**
  - Reference Images: `createReferenceImage`, `getReferenceImage`, `getAllReferenceImages`, `deleteReferenceImage`, `updateReferenceImage`
  - Design Projects: `createDesignProject`, `getDesignProject`, `getAllDesignProjects`, `updateDesignProject`
  - Design Iterations: `createDesignIteration`, `getDesignIterations`, `getLatestIteration`
  - B2C Sales: `bulkCreateB2cSales`, `getSalesByBdm`, `getDistinctBdmNames`, `clearB2cSales`
  - Stock Items: `bulkCreateStockItems`, `getStockItemsByCategory`, `getStockItemsByStyleNos`, `updateStockItem`, `getStockItemsPendingEmbedding`, `clearStockItems`
  - Recommendations: `getStockItemsForRecommendation`, `findMatchingEarring`, `getDistinctStates`, `getStockCandidatePool`
  - Assortment Plans: `createAssortmentPlan`

### `server/db.ts`
- **Purpose:** Drizzle ORM initialization + PostgreSQL pool (3 lines)
- **Contains:** `db` export (Drizzle instance wrapping pg Pool)
- **Do not modify**

### `server/vector-store.ts`
- **Purpose:** pgvector abstraction (6 functions, 139 lines)
- **Functions:**
  - `addVector(id, embedding, metadata)` — Add/update vector in DB
  - `searchSimilarVectors(queryEmbedding, topK=3, themeCode?)` — Cosine similarity search
  - `getAllVectors()` — Fetch all vectors (migration/debug)
  - `deleteVector(id)` — Mark vector as null
  - `clearVectorStore()` — Null all vectors (re-embedding)
  - `migrateJsonToVector()` — One-time migration: JSONB → pgvector column
- **Cosine Distance Formula:** `1 - (embedding_vector <=> query_vector)` = similarity (0-1 range)

### `server/costing.ts`
- **Purpose:** Design costing calculations (9k bytes)
- **Exports:**
  - `STONE_DATA` — Rate tables for polki, diamond, color stones, emeralds
  - `GOLD_PURITY` — Map of purity % (14k=0.585, 18k=0.75, 22k=0.916)
  - `generateCostingReport(input)` — Main costing calculation
  - Helper functions: `splitBudget`, `calculateGold`, `calculatePolki`, `calculateDiamond`, `calculateColorStones`, `calculateEmeralds`

### `shared/schema.ts`
- **Purpose:** Single source of truth for all types + validation (200+ lines)
- **6 Drizzle Tables:**
  1. `referenceImages` — Uploaded design references with pgvector embeddings
  2. `designProjects` — User design requests + AI-generated outputs
  3. `designIterations` — Edit history per project
  4. `b2cSales` — B2C transaction history (imported from Excel)
  5. `stockItems` — Inventory with optional embeddings (assortment planning)
  6. `assortmentPlans` — Saved shipment recommendations
- **9 Zod Schemas:** Insert schemas (omit id/createdAt), input schemas (additional omits)
- **Constants:** `THEME_CODES` (9 codes), pgvector custom type (3072-dim)

---

## Key File Locations

### Entry Points
- `server/index.ts` — Server startup (HTTP listener on port 5000)
- `client/src/main.tsx` — React root render
- `client/src/App.tsx` — Wouter router definition

### Configuration
- `package.json` — Dependencies + scripts (npm run dev, npm run build, npm run check)
- `vite.config.ts` — Vite + esbuild config, path aliases (@ → client/src)
- `tsconfig.json` — TypeScript compiler options, path aliases
- `drizzle.config.ts` — Drizzle migration config
- `.env` — API keys, DATABASE_URL (gitignored)

### Core API Logic
- `server/routes.ts` — All 18 endpoints (2523 lines)
- `server/google-client.ts` — Gemini Vision/Embed/Generate (44k bytes)
- `server/costing.ts` — Design costing calculations (9k bytes)

### Data Access
- `server/storage.ts` — DatabaseStorage class (DAO pattern, 250+ lines)
- `server/vector-store.ts` — pgvector search abstraction
- `server/db.ts` — Drizzle + PostgreSQL pool
- `shared/schema.ts` — All Drizzle table definitions + Zod schemas

### Client API Integration
- `client/src/lib/api.ts` — Typed fetch wrappers (620+ lines)
- `client/src/lib/jewellery-logic.ts` — Domain constants (categories, motifs, stones, etc.)

### Main Pages
- `client/src/pages/home.tsx` — Design Studio (design form + result display)
- `client/src/pages/references.tsx` — Reference Library (upload, manage)
- `client/src/pages/modify.tsx` — Design Modifier (edit existing design)
- `client/src/pages/assortment.tsx` — Assortment Planning (stock recommendations)

### Key Components
- `client/src/components/design-form.tsx` — Main design input form
- `client/src/components/result-display.tsx` — Generated image viewer + iteration controls
- `client/src/components/cost-report.tsx` — Costing breakdown display
- `client/src/components/layout.tsx` — App shell (header, nav, footer)

---

## Naming Conventions

### Files
- **Pages:** kebab-case (home.tsx, not-found.tsx, cad-comparison.tsx)
- **Components:** PascalCase (DesignForm, ResultDisplay, CostReport)
- **Utilities/Hooks:** kebab-case with prefix (use-toast.ts, use-mobile.tsx)
- **API handlers:** lowercase with hyphens (/api/reference-images, /api/generate-design)
- **Images/uploads:** snake_case with timestamp (generated_1712345678901.png, thumb_1712345678901_abc.jpg)

### Functions & Variables
- **Async functions:** camelCase, often prefixed with action verb (generateDesign, uploadReferenceImage, searchSimilarVectors)
- **Type names:** PascalCase (VisionAnalysisResult, DesignRequest, ModelResult)
- **Enum-like constants:** UPPER_SNAKE_CASE (THEME_CODES, CATEGORIES, GOLD_PURITY, STONE_DATA)
- **Regular variables:** camelCase (isGenerating, editPrompt, currentImageIndex)

### Database & Types
- **Table names:** snake_case plural (reference_images, design_projects, b2c_sales)
- **Column names:** snake_case (theme_code, generated_image_url, embedding_vector)
- **Zod schemas:** camelCase with Schema suffix (insertReferenceImageSchema, designProjectInputSchema)
- **TypeScript types/interfaces:** PascalCase (ReferenceImage, DesignProject, InsertDesignProject)

---

## Where to Add New Code

### New Feature (Design Generation Variant)
- **Primary code:** `server/routes.ts` (add endpoint after existing `/api/generate-*` endpoints, before wildcard)
- **AI logic:** Add function to appropriate client (`server/google-client.ts`, `server/openai-client.ts`, or `server/grok-client.ts`)
- **Tests:** `tests/` (if test suite exists)
- **Example:** `/api/generate-video` would go in routes.ts, call `generateVideoWithGemini()` from google-client.ts

### New Page/Route
- **Page file:** `client/src/pages/{pageName}.tsx`
- **Route registration:** Add `<Route path="/path" component={PageName} />` in `client/src/App.tsx`
- **Nav link:** Add entry in `client/src/components/layout.tsx` navigation section
- **API calls:** Add fetch wrappers to `client/src/lib/api.ts`
- **Server endpoints:** Add routes to `server/routes.ts` (before static wildcard)
- **Example:** `/assortment` page added following this pattern

### New Component
- **Implementation:** `client/src/components/{ComponentName}.tsx`
- **Location:** Use subdirectories for feature groups (e.g., `components/ui/` for shadcn, `components/form-fields/` for form components)
- **Pattern:** Export as named export, follow existing component style (props interface, className patterns, shadcn usage)
- **Example:** `CostReport` component in `client/src/components/cost-report.tsx`

### New Database Entity
- **Schema:** Add Drizzle table to `shared/schema.ts`
- **Zod schema:** Create insert schema via `createInsertSchema()`
- **Storage methods:** Add CRUD methods to `DatabaseStorage` class in `server/storage.ts`
- **Endpoints:** Add route handlers in `server/routes.ts`
- **Sync:** Run `npm run db:push` to migrate
- **Example:** `assortmentPlans` table added following this pattern

### Utilities & Helpers
- **Shared logic:** `client/src/lib/` (if client-side) or `server/` (if server-side)
- **Constants:** Domain constants in `client/src/lib/jewellery-logic.ts`, server helpers inline in routes.ts or separate file
- **Example:** `STYLE_INSPIRATIONS` constant in jewellery-logic.ts, `BRAND_RULES` string in routes.ts

### Styling
- **Tailwind classes:** Prefer utility classes in JSX, use `cn()` for conditional styling
- **Global styles:** Add to `client/src/index.css` (already has Tailwind setup)
- **Theme colors:** Defined in `index.css` as CSS custom properties (--primary, --secondary, etc.)
- **Component libraries:** Use existing shadcn/ui components from `client/src/components/ui/`

---

## Special Directories

### `uploads/`
- **Purpose:** Disk storage for user-uploaded reference images + AI-generated outputs
- **Generated:** At runtime by multer diskStorage
- **Committed:** No (add to .gitignore)
- **Lifetime:** Persists across restarts; cleaned by user via delete endpoints
- **Structure:**
  ```
  uploads/
  ├── {timestamp}-{random}.jpg         # Reference image
  ├── thumb_{timestamp}-{random}.jpg   # Thumbnail
  ├── generated_{timestamp}.png        # Gemini-generated sketch
  ├── cad_{timestamp}.png              # OpenAI CAD
  └── grok_{timestamp}.png             # Grok output
  ```

### `designs/`
- **Purpose:** Organized long-term storage for saved designs (by category/theme)
- **Generated:** At runtime via `/api/design-projects/:id/save` endpoint
- **Committed:** No
- **Structure:**
  ```
  designs/
  └── {category}/
      └── {theme}/
          └── {timestamp}.png          # Saved design
  ```

### `.planning/codebase/`
- **Purpose:** GSD (Grok-Subagent-Driven) planning artifacts (architecture docs)
- **Generated:** By `/gsd-map-codebase` agent with focus areas (arch, tech, quality, concerns)
- **Committed:** Yes (useful reference for future dev)
- **Contents:** ARCHITECTURE.md, STRUCTURE.md, STACK.md, INTEGRATIONS.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

### `node_modules/`
- **Purpose:** Installed npm dependencies
- **Generated:** By `npm install`
- **Committed:** No (in .gitignore)

---

## Build & Development Paths

### Development (npm run dev)
- **Entry:** `server/index.ts` with NODE_ENV=development
- **Client build:** Vite dev server on port 5000 (hot reload enabled)
- **Server:** Express with Vite middleware proxying to dev server
- **Assets:** Served from `client/src/` and `uploads/`, `designs/` directories

### Production (npm run build → npm run start)
- **Build step:** Vite generates `dist/client/`, esbuild produces `dist/index.cjs`
- **Assets:** Static bundle served from `dist/client/` via `serveStatic()`
- **Server:** Express without Vite middleware
- **Port:** Still 5000

---

*Structure analysis: 2025-04-14*
