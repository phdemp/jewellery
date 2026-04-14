# External Integrations

**Analysis Date:** 2025-04-14

## APIs & External Services

**Google AI (Gemini):**
- Service: Google Generative AI (Gemini 2.5 Flash, Gemini 3 Pro Image Preview)
- What it's used for: Vision analysis, text embeddings, image generation, image editing, marketing visuals
- SDK/Client: `@google/genai` 1.32.0
- Auth: API key via `GEMINI_API_KEY` environment variable
- Endpoints:
  - `models.generateContent()` - Vision analysis of reference images
  - `models.embedContent()` - 3072-dim text and image embeddings
  - Image generation for sketch, CAD, and marketing workflows
- Timeouts: 180s for image generation, 30s for vision analysis
- Retry: Auto-retry once on transient errors (DEADLINE_EXCEEDED, UNAVAILABLE, 503) with 3s delay

**OpenAI (gpt-image-1):**
- Service: OpenAI Image Generation API
- What it's used for: CAD renders, design modification, marketing visuals (secondary model)
- SDK/Client: `openai` 6.10.0
- Auth: API key via `OPENAI_API_KEY` environment variable
- Models: `gpt-image-1` (image generation), `dall-e-3` (alternative, not primary)
- Status: **Billing hard limit reached** (2026-03-27) — all calls return `400 Billing hard limit has been reached`
- Endpoints:
  - `/v1/images/generate` - Text-to-image generation
  - `/v1/images/edits` - Image editing (multipart/form-data)

**xAI Grok (grok-imagine-image):**
- Service: xAI Image Generation API
- What it's used for: Text-to-image generation and image editing (tertiary model)
- SDK/Client: OpenAI SDK with `baseURL: "https://api.x.ai/v1"` (text-to-image only); raw fetch for image edits (JSON body)
- Auth: API key via `GROK_API_KEY` environment variable
- Endpoints:
  - `/v1/images/generations` - Text-to-image (via OpenAI SDK)
  - `/v1/images/edits` - Image editing (via raw fetch with JSON body, not multipart)
- Content filter: Custom animal/bird motif name replacement to avoid content moderation flags
- Front-view enforcement: `GROK_VIEW_PREFIX` prepended to all prompts to force flat, 2D front-view output

## Data Storage

**Databases:**
- PostgreSQL (primary)
  - Connection: `DATABASE_URL` environment variable
  - Client: `pg` 8.16.3 (Node.js driver)
  - ORM: Drizzle ORM 0.39.3 (TypeScript-safe)
  - Tables: `reference_images`, `design_projects`, `design_iterations`, `b2c_sales` (assortment planning)
  - Extensions: pgvector for 3072-dimensional vector similarity search

**File Storage:**
- Local filesystem
  - Reference images: `uploads/` directory
  - Generated designs: `designs/` directory (organized by category/theme)
  - Modifications: `designs/modifications/` directory
  - Marketing visuals: `designs/marketing/` directory

**Caching:**
- TanStack React Query - In-memory client-side cache (no external cache backend)

## Vector Search

**pgvector (3072-dim cosine similarity):**
- Used by: RAG pipeline for design generation
- Implementation: `server/vector-store.ts`
- Operation: `embedding_vector <=> query_vector` (cosine distance operator)
- Query formula: `1 - (embedding_vector <=> vector)` returns similarity score (0-1)
- Indexes: Similarity search limited to vectors with non-null `embedding_vector`
- Optional filtering: By `theme_code` field for organized searches

## Authentication & Identity

**Auth Provider:**
- Custom (no auth system deployed)
- Structure: No authentication middleware or session management active
- Note: `SESSION_SECRET` environment variable exists but no session middleware configured in Express

**Google Drive Integration (Connector-based):**
- Service: Google Drive API for bulk reference image imports
- SDK: `googleapis` 148.0.0, `google-auth-library` 10.5.0
- Auth Method: Replit Connectors (OAuth 2.0 via Replit infrastructure)
  - Token refresh: Every 30 minutes or when expired
  - Credentials source: `REPLIT_CONNECTORS_HOSTNAME` and `REPL_IDENTITY` environment variables
- Usage: Bulk import reference images from user's Google Drive folder
- Endpoint: `POST /api/import-from-drive`

## Monitoring & Observability

**Error Tracking:**
- Sentry (frontend + backend)
  - Frontend DSN: `VITE_SENTRY_DSN` environment variable
  - Backend DSN: `SENTRY_BACKEND_DSN` environment variable
  - Status: Enabled only if DSN is configured
  - Integration points:
    - Server: Error handler capture in `server/index.ts`
    - Client: App-level initialization in `client/src/main.tsx` and API error capture in `lib/api.ts`

**Logs:**
- Approach: Console logging only
  - API request/response timing: Logged to console with formatted timestamps
  - Gemini retry warnings: Logged on transient error retry
  - Migration and initialization logs: Standard console output

**Timing:**
- Per-model timing captured for 3-model parallel generation (Gemini, OpenAI, Grok)

## CI/CD & Deployment

**Hosting:**
- Replit (single port 5000 for both API and frontend SPA)
- Static file serving: Vite-compiled React app served via Express

**CI Pipeline:**
- None detected (no GitHub Actions, GitLab CI, or similar)
- Git branches: `main` (primary), `assortment` (feature branch)

**Build Process:**
- Frontend: `vite build` → `dist/public/`
- Backend: `tsx` with esbuild compilation → `dist/index.cjs`
- Script: `script/build.ts` orchestrates full build

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
- `GEMINI_API_KEY` - Google Generative AI API key
- `GOOGLE_CLOUD_PROJECT_ID` - GCP project ID
- `OPENAI_API_KEY` - OpenAI API key
- `GROK_API_KEY` - xAI Grok API key

**Optional env vars:**
- `VITE_SENTRY_DSN` - Frontend error tracking
- `SENTRY_BACKEND_DSN` - Backend error tracking
- `SESSION_SECRET` - Express session secret (not currently used)
- `PORT` - Server port (default 5000)
- `NODE_ENV` - Deployment environment (development/production)
- Replit-specific: `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`

**Secrets location:**
- `.env` file (gitignored)
- Never committed to repository
- Accessed via `process.env` on server, `import.meta.env` on client (Vite)

## Webhooks & Callbacks

**Incoming:**
- None implemented (stateless API design)

**Outgoing:**
- None detected (no downstream webhook calls)

## Image Processing Pipeline

**Reference Image Upload:**
1. User uploads JPEG/PNG to `POST /api/reference-images`
2. Sharp: Resize to 300×300 JPEG thumbnail
3. Gemini Vision: Analyze image → extract style/motifs/structure
4. Generate Embedding: `generateImageEmbedding()` → 3072-dim vector
5. Store: Metadata + vector in `reference_images` table

**Design Generation (RAG Pipeline):**
1. User input → `generateTextEmbedding()` (3072-dim)
2. pgvector: `searchSimilarVectors(topK=3)` → cosine similarity
3. Gemini Vision: `analyzeReferenceImage()` on top-3 refs
4. Build prompt: `buildDesignContext()` + `buildImagePromptJSON()` + BRAND_RULES
5. 3-Model parallel:
   - Gemini 3 Pro Image: Image generation (primary)
   - OpenAI gpt-image-1: CAD render (secondary, billing-limited)
   - xAI Grok: Image generation (tertiary, content-filtered)
6. First successful → save PNG to `designs/{category}/{theme}/`
7. Store: `design_projects` record with project metadata

**Design Modification (AI Costing):**
1. User uploads image + selects parameters → `POST /api/modify-design`
2. 3-Model parallel edit via: Gemini, OpenAI, Grok
3. If `priceBand` + `goldRatePerGram` provided:
   - Gemini Vision: `analyzeDesignMaterials()` → material breakdown
   - Costing: `generateCostingReport()` → gold/stone cost breakdown
4. Save PNG + costing report + project record

## Data Import & Migration

**Stock Item Import:**
- Source: Excel file (`.xlsx`) via `xlsx` 0.18.5
- Endpoint: `POST /api/import-from-drive`
- Storage: `b2c_sales` table in PostgreSQL
- Used by: Assortment planning algorithm (SQL-based recommendations)

**Vector Migration:**
- Legacy: Embeddings stored as JSONB in `embedding` column
- Current: pgvector in `embedding_vector` column (3072-dim)
- Endpoint: `POST /api/migrate-vectors` (one-time migration)

**Thumbnail Generation:**
- Triggered: Missing 300px thumbnails in reference images
- Tool: Sharp image processing
- Endpoint: `POST /api/generate-thumbnails`

## Third-Party Libraries (Key Data/Integration Roles)

**Form/Validation Ecosystem:**
- React Hook Form + Zod: Structured design request validation
- drizzle-zod: Auto-schema generation from database tables

**Component Libraries:**
- Radix UI (15+ primitives): Accessible form inputs, dialogs, dropdowns, etc.
- Lucide React: Icons throughout UI
- Sonner: Toast notifications for user feedback
- Recharts: Costing report chart visualization

**UI Enhancement:**
- Embla Carousel: Reference image carousel on References page
- Next Themes: Dark/light mode support (configured but minimal usage)
- Framer Motion: Animations in result display cards

---

*Integration audit: 2025-04-14*
