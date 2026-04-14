# Architecture

**Analysis Date:** 2025-04-14

## Pattern Overview

**Overall:** Full-stack monorepo with **Client-Server separation** + **RAG (Retrieval-Augmented Generation) pipeline** for AI-powered jewellery design. The application implements a modern SPA architecture with a TypeScript-based Express backend.

**Key Characteristics:**
- Monorepo structure: `client/` (React SPA), `server/` (Express API), `shared/` (Zod schemas + TypeScript types)
- RAG pipeline driven by pgvector embeddings (3072-dim Gemini embeddings)
- 3-model parallel AI generation (Gemini + OpenAI + Grok) via `Promise.allSettled`
- Server-side image processing via Sharp (thumbnails, conversions)
- Drizzle ORM with PostgreSQL + pgvector extension
- Wouter-based client-side routing (lightweight, minimal overhead)
- Server port: 5000 (unified API + static asset serving)

---

## Layers

**Presentation Layer (Client):**
- Purpose: React 19 UI with Wouter routing, form state via React Hook Form + Zod, data fetching via TanStack React Query
- Location: `client/src/`
- Contains: 7 pages, 15+ reusable components, 4 lib files (api, jewellery-logic, queryClient, utils), 2 custom hooks
- Depends on: `server/routes.ts` (API), `shared/schema.ts` (types), shadcn/ui (styled components), Tailwind CSS
- Used by: End users (design studio, references, modify, CAD comparison, marketing, assortment planning)

**API Layer (Server Routes):**
- Purpose: Handle HTTP requests, orchestrate AI calls, manage file uploads, database operations
- Location: `server/routes.ts` (2523 lines, 17 endpoints + 1 debug endpoint)
- Contains: Multer config, endpoint handlers, helper functions (`firstSuccessfulUrl`, `toModelResult`, `buildCADPromptJSON`, `buildImagePromptJSON`, etc.)
- Depends on: Google Gemini client, OpenAI client, Grok client, Drizzle ORM, pgvector vector store, file system, Sharp
- Used by: All client pages

**AI/ML Layer:**
- Purpose: Interface with external AI providers (Gemini 2.5 Flash for vision/embeddings, Gemini 3 Pro Image for generation, OpenAI gpt-image-1, xAI Grok)
- Location: `server/google-client.ts`, `server/openai-client.ts`, `server/grok-client.ts`
- Contains: 14 Gemini functions, 3 OpenAI functions, 3 Grok functions
- Depends on: `@google/genai` SDK, `openai` SDK, raw `fetch` for Grok JSON edits
- Used by: `server/routes.ts`

**Vector Search Layer:**
- Purpose: Semantic similarity search via pgvector cosine distance (1 - distance = similarity)
- Location: `server/vector-store.ts` (6 functions)
- Contains: `addVector`, `searchSimilarVectors`, `getAllVectors`, `deleteVector`, `clearVectorStore`, `migrateJsonToVector`
- Depends on: PostgreSQL with pgvector extension
- Used by: RAG pipeline in `/api/generate-design`

**Data Persistence Layer (Storage):**
- Purpose: CRUD operations for all entities (reference images, design projects, iterations, B2C sales, stock items, assortment plans)
- Location: `server/storage.ts` (DatabaseStorage class implementing IStorage)
- Contains: 18 methods (reference images, design projects, design iterations, B2C sales, stock items, recommendations, assortment plans)
- Depends on: Drizzle ORM, PostgreSQL schema (`shared/schema.ts`)
- Used by: `server/routes.ts`

**Schema/Type Layer (Single Source of Truth):**
- Purpose: Zod validators + Drizzle table definitions for all database entities
- Location: `shared/schema.ts`
- Contains: 6 tables (referenceImages, designProjects, designIterations, b2cSales, stockItems, assortmentPlans), Zod insertion schemas, theme codes
- Depends on: Drizzle ORM, Zod
- Used by: Both frontend (type safety) and backend (validation, ORM)

---

## Data Flow

**RAG Pipeline (Design Generation):**

1. **User Input** → `DesignRequest` from `client/src/pages/home.tsx` form
2. **Text Embedding** → POST `/api/generate-design` → `generateTextEmbedding()` (Gemini, 3072-dim)
3. **Vector Search** → `searchSimilarVectors(topK=3)` (pgvector cosine <=>)
4. **Reference Analysis** → `analyzeReferenceImage()` on top-3 refs (Gemini Vision)
5. **Context Building** → `buildDesignContext(params, similarDesigns)` (pure function)
6. **Prompt Generation** → `buildImagePromptJSON(context, extras)` (JSON-structured prompt)
7. **3-Model Generation** → `Promise.allSettled([Gemini, OpenAI, Grok])` in parallel
   - Gemini: `generateJewellerySketch(prompt)` → PNG base64 → save to `/uploads/generated_*.png`
   - OpenAI: `generateCADImageWithOpenAI(prompt)` → PNG base64 → save to `/uploads/cad_*.png`
   - Grok: `generateImageWithGrok(prompt)` → PNG base64 → save to `/uploads/grok_*.png`
8. **First Success** → `firstSuccessfulUrl()` picks first non-null result for `generatedImageUrl`
9. **Storage** → `createDesignProject(data)` → saves to `design_projects` table
10. **Response** → Return `DesignGenerationResponse` with all 3 model results + backward-compat `generatedImageUrl`

**Asynchronous Costing Flow (Triggered on generate/modify/cad-comparison when priceBand + goldRate provided):**

1. Read generated image as base64
2. `analyzeDesignMaterials(base64, params)` (Gemini Vision) → `MaterialBreakdown` (gold %, polki count, stone estimates)
3. User's gold percentage from slider (5-95%, default 40%)
4. `generateCostingReport({ totalBudget, goldPercentage, goldRate, purity, stones })` → `CostingReport`
5. Return report in response (`costReport` field)

**Design Modification Flow:**

1. User uploads image + selects parameters
2. POST `/api/modify-design` (multipart, `memoryUpload`)
3. Read image as base64
4. Build edit prompt from parameters
5. `Promise.allSettled([Gemini, OpenAI, Grok])` modify operations in parallel
6. Optionally: Costing analysis if priceBand + goldRate provided
7. `createDesignProject(data)` → save to DB
8. Return `ModifyDesignResponse`

**Reference Image Upload Flow:**

1. POST `/api/reference-images` (multipart, `upload` disk storage)
2. Save original image to `uploads/{timestamp}-{random}.jpg`
3. Generate 300x300 thumbnail via Sharp → `uploads/{timestamp}-{random}-thumb.jpg`
4. `analyzeReferenceImage(base64)` (Gemini Vision) → `VisionAnalysisResult`
5. `generateImageEmbedding(base64)` → 3072-dim vector
6. `addVector(id, embedding, metadata)` → pgvector column update
7. `createReferenceImage(data)` → save to `reference_images` table
8. Return `ReferenceImage` with all metadata

**State Management:**

- **Client State:** React Hook Form (form values), Framer Motion (animations), TanStack React Query (server state caching)
- **Server State:** PostgreSQL (persistent), in-memory design import job state (`designImportJob` object in routes.ts)
- **Transient State:** Multer memory uploads, Sharp processing buffers, API response objects

---

## Key Abstractions

**DatabaseStorage (IStorage Interface):**
- Purpose: Abstract all database operations behind typed interface
- Examples: `server/storage.ts` (DatabaseStorage class)
- Pattern: Data Access Object (DAO) with method-per-operation (no query builders exposed)
- Key methods: `createReferenceImage`, `getDesignProject`, `getStockItemsForRecommendation`, `createAssortmentPlan`

**VisionAnalysisResult & DesignContext:**
- Purpose: Strongly-typed structures for RAG pipeline intermediate results
- Examples: Defined in `server/google-client.ts`
- Pattern: TypeScript interfaces with optional fields for flexibility
- Usage: `analyzeReferenceImage()` returns VisionAnalysisResult; `buildDesignContext()` combines user input + analysis

**ModelResult:**
- Purpose: Unified shape for multi-model generation results
- Examples: Defined in `client/src/lib/api.ts`
- Pattern: `{ imageUrl: string | null, error: string | null, model: string }`
- Usage: All 4 image-generation endpoints return results for Gemini, OpenAI, Grok

**DesignRequest (Type Definition):**
- Purpose: Complete user design form input
- Examples: Defined in `client/src/lib/jewellery-logic.ts`
- Pattern: Union of optional string fields, arrays, numbers (covers all form fields across 3 generation pages)
- Usage: Passed from form to `generateDesign()` API call

**Zod Schemas (Shared Validation):**
- Purpose: Single source of truth for data validation
- Examples: `insertReferenceImageSchema`, `insertDesignProjectSchema`, `driveImportRequestSchema` in `shared/schema.ts`
- Pattern: Derived from Drizzle table definitions using `createInsertSchema`, then extended with `.omit()` / `.extend()`
- Usage: Server-side validation before database insert; client-side form validation

---

## Entry Points

**Server Entry Point:**
- Location: `server/index.ts` (106 lines)
- Triggers: `npm run dev` or `npm start`
- Responsibilities:
  1. Initialize Sentry error tracking
  2. Create Express app + HTTP server
  3. Setup static file serving (`/uploads`, `/designs` directories)
  4. Add JSON body parser with raw body capture (for Sentry)
  5. Register all API routes via `registerRoutes(httpServer, app)`
  6. Setup Vite dev middleware (dev only) or static serving (prod)
  7. Listen on port 5000

**Client Entry Point:**
- Location: `client/src/main.tsx` (13 lines)
- Triggers: Browser loads `index.html`
- Responsibilities:
  1. Initialize Sentry React error boundary
  2. Create React root
  3. Render `<App />` component

**App Router:**
- Location: `client/src/App.tsx` (59 lines)
- Triggers: Page load or route navigation
- Responsibilities:
  1. Wrap router with QueryClientProvider (TanStack React Query)
  2. Wrap router with TooltipProvider + Toaster (shadcn/ui)
  3. Wrap router with Sentry error boundary
  4. Define 7 routes via Wouter `<Switch>` + `<Route>` components
  5. Render NotFound fallback for unmatched routes

**Layout Wrapper:**
- Location: `client/src/components/layout.tsx` (123 lines)
- Triggers: Every page via Layout component import
- Responsibilities:
  1. Render sticky header with Raniwala logo
  2. Render navigation links (6 nav items + Assortment link)
  3. Detect scroll position for header shadow/blur effect
  4. Render decorative background gradients
  5. Render main content area + footer with OrnamentalDivider

**API Route Registration:**
- Location: `server/routes.ts` → `registerRoutes(httpServer, app)` async function
- Triggers: Server startup (called from `server/index.ts`)
- Responsibilities:
  1. Initialize storage (DatabaseStorage)
  2. Register 18 endpoints (POST, GET, DELETE, PATCH)
  3. Register static file wildcard handler
  4. Return nothing (mutates app in place)

---

## Error Handling

**Strategy:** Multi-layer error tracking + user-facing error messages via Sentry + toast notifications

**Patterns:**

**Server-Side:**
1. **Try-Catch in Routes:** All endpoint handlers wrap logic in try-catch, return `{ error: message }` JSON on failure
2. **Sentry Capture:** `server/index.ts` has global error handler that captures all exceptions via `Sentry.captureException(err)`
3. **HTTP Status Codes:** Use appropriate codes (400 for bad request, 404 for not found, 500 for server error)
4. **Gemini Transient Errors:** `withRetry<T>()` helper in `server/google-client.ts` retries once after 3s pause on DEADLINE_EXCEEDED / UNAVAILABLE / 503

**Client-Side:**
1. **Try-Catch in Components:** Page components wrap API calls in try-catch
2. **Sentry React:** `client/src/App.tsx` wraps entire router in `<Sentry.ErrorBoundary>` fallback
3. **Toast Notifications:** All errors show via `toast({ title: "Error", description: error.message, variant: "destructive" })`
4. **API Error Capture:** `client/src/lib/api.ts` fetch wrappers capture errors to Sentry via `Sentry.captureException(err)`

**Cross-Cutting:**
- Validation errors return 400 with Zod error details
- Database errors return 500 with sanitized message (never expose DB schema details)
- File upload errors caught by Multer filters (size, mime type) → return 400

---

## Cross-Cutting Concerns

**Logging:**
- Server: `log(message, source)` function in `server/index.ts` formats time + source
- Middleware: Logs all `/api/*` requests with method, path, status code, duration (ms)
- Client: Console logs in dev mode (browser DevTools)
- Production: Sentry captures all errors automatically

**Validation:**
- Server-side: Zod schemas in `shared/schema.ts` validate all inputs before DB insert
- Client-side: React Hook Form + Zod validate form before submission
- File uploads: Multer fileFilter checks mime types (JPEG, PNG, WebP)

**Authentication:**
- Current: None (open API, no auth middleware)
- Note: Sentry DSN configured but no user identification (should add in future)

**CORS:**
- Current: Not configured (single-origin, both API and static served on same port)
- Assumption: Served on same domain (Replit)

**File Storage:**
- Reference uploads: `uploads/{timestamp}-{random}.{ext}` (disk, persistent)
- Reference thumbnails: `uploads/thumb_{timestamp}-{random}.jpg` (disk, 300x300)
- Generated sketches: `uploads/generated_{timestamp}.png` (disk, temp until moved to designs/)
- CAD renders: `uploads/cad_{timestamp}.png` (disk)
- Grok outputs: `uploads/grok_{timestamp}.png` (disk)
- Saved designs: `designs/{category}/{theme}/{timestamp}.png` (organized by user choice)
- All paths served statically via `app.use('/uploads', express.static(...))` and `app.use('/designs', ...)`

**Image Processing:**
- Sharp used for thumbnail generation (300x300, center crop, 80% JPEG quality)
- Base64 encoding used for AI Vision API inputs (Gemini, OpenAI, Grok)
- PNG format for all AI-generated outputs (no compression, preserve quality)

---

## Deployment Architecture

**Single Port Model:**
- Express server serves both API (`/api/*`) and static assets (`/uploads`, `/designs`, `/`, `/index.html`)
- Vite dev server integrated in dev mode via `setupVite()` middleware
- Production build: Vite generates `dist/` bundle, esbuild produces `dist/index.cjs`
- Port: 5000 (only non-firewalled port on Replit)

**Environment Configuration:**
- `.env` file contains: `DATABASE_URL`, `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT_ID`, `OPENAI_API_KEY`, `GROK_API_KEY`, `SESSION_SECRET`, `SENTRY_BACKEND_DSN`, `SENTRY_FRONTEND_DSN`
- Development: `NODE_ENV=development` loads `.env` and enables hot-reload
- Production: `NODE_ENV=production` disables Vite dev middleware, serves static only

---

*Architecture analysis: 2025-04-14*
