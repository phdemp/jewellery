# Codebase Concerns

**Analysis Date:** 2025-02-28

## Tech Debt

**Monolithic routes.ts file:**
- Files: `server/routes.ts` (2523 lines)
- Issue: Single file contains all 30+ API endpoints, constants (STYLE_INSPIRATION_DESCRIPTIONS, PORTRAIT_CATEGORIES, PRICE_BAND_BUDGET, POLKI_SIZE_DESCRIPTIONS, BRAND_RULES), helper functions (parseThemeCodeFromFilename, proxyDriveUrl, firstSuccessfulUrl, toModelResult), and bulk import logic
- Impact: Difficult to navigate, test, and maintain. Changes to one endpoint risk breaking others. Hard to reuse constants across modules. File size makes it slow to parse/edit
- Fix approach: Split into separate modules: `endpoints/`, `constants/`, `helpers/`, `importers/`. Create `brandRules.ts`, `priceBands.ts`, `portraitCategories.ts`, `styleGuides.ts`

**Loose TypeScript error typing:**
- Files: `server/google-client.ts` (11 instances), `server/routes.ts` (2 instances), `server/vector-store.ts` (1 instance)
- Issue: Multiple `catch (error: any)` blocks throughout error handling. Also uses `embedding as any` when storing JSONB embedding data (lines 208, 465, 1126, 1198 in routes.ts)
- Impact: Loss of type safety, harder to debug, IDE can't provide error context. Any type defeats TypeScript's main benefit
- Fix approach: Define `ApiError` or `GeminiError` interface, use proper error narrowing with `instanceof Error` checks. Create `types/errors.ts`

**Loose JSON parsing in request handlers:**
- Files: `server/routes.ts` (multiple endpoints handle array/object fields)
- Issue: Inconsistent manual JSON parsing fallbacks like `JSON.parse(req.body.polkiSize)` with bare `try/catch` blocks discarding errors. Lines 549, 553, 558, 562, 567, 569, 1316-1347 show repeated manual parsing logic with silent failures
- Impact: Malformed input silently becomes empty arrays `[]`. No user feedback. Makes debugging client-server mismatches painful
- Fix approach: Centralize request parsing middleware using Zod schema refinements. Create request validation layer that returns detailed 400 errors instead of silent fallbacks

**Unused/Dead code:**
- Files: `server/google-client.ts`, `server/routes.ts`
- Issue: `buildImagePromptLegacy()` function in google-client.ts (marked as kept but not called). Design Image Bulk Import logic in routes.ts (lines 100-223: `designImportJob` state never exposed in API, `runDesignImageImport()` called only once on startup)
- Impact: Confusion about which prompt builder to use. Dead import/export paths in code
- Fix approach: Remove legacy prompt builder. Extract design import logic to separate `importers/designImages.ts` module with proper lifecycle management

## Known Bugs

**OpenAI API hard billing limit reached:**
- Symptoms: All `gpt-image-1` calls return `400 Billing hard limit has been reached`. Affects 3 endpoints: `/api/generate-design` (CAD mode), `/api/modify-design`, `/api/generate-cad-comparison`
- Files: `server/openai-client.ts`, `server/routes.ts` (lines 740-821, 1416-1492, 1591-1641)
- Trigger: Any request to endpoints running 3-model parallel generation (Gemini + OpenAI + Grok)
- Workaround: Gemini and Grok continue working. Set OpenAI model result to error state in response, front-end falls back to Gemini result
- Root cause: Account billing limit exceeded at platform.openai.com/account/billing/limits
- Fix approach: Increase account billing limit or add credits. Alternatively, remove OpenAI from 3-model pipeline and run Gemini + Grok only. Update `/api/generate-cad-comparison` to use only Gemini + Grok (requires UI updates for 2-model comparison instead of 3)

**Google Drive image proxying broken by CORS:**
- Symptoms: Google Drive `uc?export=view` URLs fail in browser `<img>` tags with `Cross-Origin-Resource-Policy: same-site` error. Affects assortment page stock item image display
- Files: `server/routes.ts` (line 2434-2455 `/api/drive-image/:fileId` proxy endpoint), `client/src/pages/assortment.tsx` (image URL usage)
- Trigger: Browser attempts to load `https://drive.google.com/uc?export=view&id=...` directly in `<img>` tag
- Current mitigation: Proxy endpoint exists at `/api/drive-image/:fileId` and `proxyDriveUrl()` converts Google Drive URLs to local proxy URLs (line 2002-2007)
- Verification needed: Confirm proxy endpoint works and assortment page uses it correctly

**Stock item image_url contains single spaces:**
- Symptoms: Some stock items in database have `image_url = ' '` (single space character) instead of empty string or null. Causes `TRIM(image_url) <> ''` SQL filter to pass for invalid entries
- Files: `server/routes.ts` (lines 2064, 2279 in import and recommendation logic)
- Trigger: During stock import from Excel, empty cells converted to spaces. Example: `OSOLO73320NLS` has space in cell C15
- Current mitigation: `TRIM()` used in SQL WHERE clauses (line 2279)
- Fix approach: Update Excel import logic to convert whitespace-only strings to NULL. Add SQL constraint `CHECK(TRIM(image_url) <> '')` to `stock_items` table

## Security Considerations

**No authentication/authorization system:**
- Risk: All endpoints are publicly accessible. Anyone can generate unlimited AI images, modify designs, import stock data, embed items, delete reference images
- Files: `server/index.ts` (no auth middleware), all endpoint files in `server/routes.ts`
- Current mitigation: None — relies on Replit deployment being private
- Recommendations:
  1. Add Express middleware for auth (JWT tokens or sessions)
  2. Create auth.ts middleware: verify API key header or session cookie
  3. Protect sensitive endpoints: `/api/import-*`, `/api/migrate-*`, `/api/debug-*`, `/api/reembed-*`, `/api/assortment/import-*`
  4. Allow public: `/api/generate-*`, `/api/reference-images` (GET), `/api/design-projects` (GET), `/api/drive-image`
  5. Add rate limiting per IP/user to prevent abuse of expensive AI endpoints

**No rate limiting on AI generation:**
- Risk: Attacker can spam `/api/generate-design` endpoint and exhaust Gemini API quotas or incur massive charges if billing limits increase
- Files: `server/routes.ts` (line 541 `/api/generate-design`, line 1302 `/api/modify-design`, line 1654 `/api/generate-marketing`)
- Current mitigation: None
- Recommendations:
  1. Add `express-rate-limit` middleware
  2. Rate limit by IP: 5 requests/minute for generation endpoints, 1 request/second for others
  3. Log rate limit violations to Sentry
  4. Return 429 Too Many Requests with retry-after header

**No input validation on some endpoints:**
- Risk: Malformed requests could crash server or cause unpredictable behavior
- Files: `server/routes.ts` (assortment endpoints like `/api/assortment/generate-recommendations` at line 2239 don't validate `req.body`)
- Current mitigation: Some endpoints use Zod `designProjectInputSchema.parse()` (lines 590, 836, 1525), but assortment endpoints have no validation
- Recommendations:
  1. Create Zod schemas for all POST request bodies
  2. Add validation middleware that returns 400 with details on validation failure
  3. Example: `assortmentRecommendationSchema` for `/api/assortment/generate-recommendations`

**Hardcoded file paths in production:**
- Risk: Assumes `uploads/`, `designs/`, `Stock Item Details.xlsx`, `b2b sales data 1 YEAR.xlsx` exist in cwd
- Files: `server/routes.ts` (lines 64, 182, 2012, 2054, 2064)
- Current mitigation: `fs.mkdirSync("uploads", { recursive: true })` in `server/index.ts` (line 17)
- Recommendations:
  1. Add environment variable `UPLOADS_DIR`, `DESIGNS_DIR`
  2. Validate paths exist on startup, fail fast
  3. Create directories with proper permissions

**Sentry error reporting enabled but may leak sensitive data:**
- Risk: Error messages captured by Sentry could contain API responses with partial data, user input, or file paths
- Files: `server/index.ts` (line 1-7, Sentry.init and Sentry.captureException)
- Current mitigation: `enabled: !!process.env.SENTRY_BACKEND_DSN` (only sends if env var set)
- Recommendations:
  1. Add Sentry event processor to scrub sensitive fields (API keys, file paths, user IDs from request bodies)
  2. Example: `integrations: [new Sentry.Integrations.RequestData({ include: { cookies: false, headers: false } })]`

## Performance Bottlenecks

**Gemini Vision + Embedding chain on every reference image upload:**
- Problem: `/api/reference-images` POST calls `analyzeReferenceImage()` (Gemini Vision, ~10-30s) + `generateImageEmbedding()` (Vision again + embedding, ~10-20s) sequentially
- Files: `server/routes.ts` (lines 428-489)
- Cause: Every reference image triggers 2 expensive Gemini calls. Bulk import in design import job repeats this 3x per image (line 189-190)
- Improvement path:
  1. Cache embedding results: add `embedding_cached` flag to `reference_images` table
  2. Batch embeddings: collect 10 images, call `/api/reembed-references` in background instead of on-upload
  3. Consider: skip image embedding on upload, only embed on-demand during `/api/generate-design` if not cached
  4. Timeouts: Gemini image calls use 180s timeout (line 1126 in google-client.ts comment), increase to 240s for Vision reliability

**Synchronous file system operations in async handlers:**
- Problem: File reads/writes are synchronous (`fs.readFileSync`, `fs.writeFileSync`) in async endpoints, blocking event loop
- Files: `server/routes.ts` (lines 178, 36 in openai-client.ts), `server/grok-client.ts` (line 37)
- Cause: Mixed use of async APIs (multer, db queries) with sync fs operations
- Impact: Under load, event loop blocks on disk I/O, slowing all concurrent requests
- Improvement path:
  1. Replace `fs.readFileSync` → `await fs.readFile()` (use fs/promises)
  2. Replace `fs.writeFileSync` → `await fs.writeFile()`
  3. Use `await fs.copyFile()` instead of `fs.copyFile()` in background jobs
  4. Audit: 45+ instances to update

**Stock item embedding pipeline without concurrency control:**
- Problem: `/api/assortment/embed-stock` processes items in batches of 5 (line 2136) with 500ms pause (line 2162), but no backpressure if Gemini quota hits
- Files: `server/routes.ts` (lines 2120-2168)
- Cause: Simple sequential batch processing with fixed delay
- Impact: If one embedding fails, entire pipeline pauses. Quota exhaustion causes 100+ failing items in sequence
- Improvement path:
  1. Add retry logic with exponential backoff (3 retries, 1s/5s/30s)
  2. Skip failed items, continue with rest
  3. Aggregate errors and report at end
  4. Monitor quota usage, pause pipeline if approaching limits

**No connection pooling config exposed:**
- Problem: PostgreSQL connection pool uses default size (probably 10 connections)
- Files: `server/db.ts` (10 lines, Drizzle ORM setup)
- Cause: No `max` pool size in config
- Impact: Under 20+ concurrent users, connection exhaustion could slow queries
- Improvement path:
  1. Add `poolSize: 20, idleTimeout: 30000` to db connection config
  2. Add metrics: monitor pool usage via `SELECT count(*) FROM pg_stat_activity`
  3. Test: load test with `artillery quick -d 30 -r 10 http://localhost:5000/api/reference-images`

## Fragile Areas

**Design form field cascades (Home, Modify, CAD pages):**
- Files: `client/src/pages/home.tsx`, `client/src/pages/modify.tsx`, `client/src/pages/cad-comparison.tsx`, `client/src/components/design-form.tsx`
- Why fragile: Product Segment → Category → Price Band cascading dropdowns maintained in 3 separate places. If `jewellery-logic.ts` constant changes, all 3 forms must update. No shared component for cascade logic
- Safe modification:
  1. Extract cascade logic to custom hook: `useCascadingCategories(segment)` returning filtered categories + priceband options
  2. Create single `<SegmentCategoryPriceBandSelect>` component used by all 3 pages
  3. Update in one place: `client/src/lib/jewellery-logic.ts` constants
- Test coverage: No unit tests for cascade logic. Add tests for `getRelatedCategories()` function if it exists, or create it

**Polki Size descriptions embedded in routes.ts:**
- Files: `server/routes.ts` (lines 255-260 POLKI_SIZE_DESCRIPTIONS constant)
- Why fragile: Large text descriptions used for AI prompts. If brand guidelines change, descriptions become stale. Hardcoded in backend, frontend has no way to fetch updated descriptions
- Safe modification:
  1. Move to database table `polki_size_options(id, name, description, active)` with timestamps
  2. Create `/api/config/polki-sizes` endpoint to fetch descriptions
  3. Frontend caches descriptions in `useQuery` with 1-hour staleTime
  4. Update process: admin edits in DB, descriptions auto-sync to frontend

**Vector store migration logic (JSONB → pgvector) left in production:**
- Files: `server/routes.ts` (lines 1227-1239 `/api/migrate-vectors` endpoint)
- Why fragile: One-time migration endpoint still exposed as public API. If accidentally called twice or after migrations, could corrupt vector data
- Safe modification:
  1. Move logic to standalone script: `scripts/migrate-jsonb-to-pgvector.ts`
  2. Remove endpoint from routes.ts
  3. Document: run migration once via `npx tsx scripts/migrate-jsonb-to-pgvector.ts` before first production deploy
  4. Add guard: check if `embedding` JSONB column is empty, skip if already migrated

**Assortment plan save endpoint has no error boundary:**
- Files: `server/routes.ts` (lines 2503+ `/api/assortment/save-plan` endpoint)
- Why fragile: Creates `AssortmentPlan` records without validating if referenced `stock_items` IDs exist. Foreign key constraint would fail silently
- Safe modification:
  1. Add explicit validation: query `SELECT id FROM stock_items WHERE id IN (...)` and verify count matches
  2. Return 400 with details if any IDs missing
  3. Add NOT NULL constraint to `assortment_plans.stock_item_ids` in schema

## Scaling Limits

**pgvector cosine similarity search speed degrades with large datasets:**
- Current capacity: ~500+ reference images with 3072-dim embeddings. Query time ~50-100ms for `LIMIT 3`
- Limit: At 10,000+ reference images, vector search without index becomes O(n) and hits 1-2 second latency
- Scaling path:
  1. Add pgvector index: `CREATE INDEX ON reference_images USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);`
  2. Monitor: track query time in logs via `console.log` before/after search
  3. Benchmark: compare unindexed vs indexed on 5000+ vectors
  4. If needed, migrate to external vector DB (Pinecone, Weaviate)

**Gemini API quota limits (1M tokens/min for free tier):**
- Current capacity: ~50 design generations/day (each generation ~20K tokens for prompt + response analysis). Stock embedding batch ~2K tokens per item
- Limit: At 1000+ embedding operations or 500+ design generations/day, quota exhaustion
- Scaling path:
  1. Monitor token usage via `console.log` in google-client.ts functions
  2. Add Redis rate limiter: `2 requests/second per endpoint, globally max 5000 requests/day`
  3. Implement request queuing: queue overages, process at 1req/second after hits
  4. Consider: batch 10 design requests together, call Gemini once per batch
  5. Upgrade to paid Gemini tier ($50/month) for higher limits

**Database growth without archival strategy:**
- Current data: ~6000+ B2C sales records, ~15,000+ stock items, ~500 design projects, ~1000+ design iterations
- Limit: At 1 year of daily 100+ designs + 5000+ monthly stock updates, tables hit 500K+ rows, full table scans slow
- Scaling path:
  1. Add composite indexes: `(category, theme)` on `design_projects`, `(bdm_name, created_at)` on `b2c_sales`
  2. Archive old records: design projects older than 1 year to `design_projects_archive` table
  3. Implement: `SELECT * FROM design_projects WHERE created_at > NOW() - INTERVAL '1 year'` in queries
  4. Monitor: check `pg_stat_user_tables` for sequential scans on large tables

## Dependencies at Risk

**OpenAI API client with hard billing limit:**
- Risk: Library is maintained but API tier is out of credits. SDK updates won't help
- Impact: All 3 image endpoints return OpenAI errors. Cannot fix without adding billing credits
- Migration plan:
  1. Stop using `gpt-image-1` entirely
  2. Run 2-model pipeline instead: Gemini + Grok only
  3. Update endpoints: `/api/generate-design`, `/api/modify-design`, `/api/generate-cad-comparison`, `/api/generate-marketing`
  4. Update response types: remove `openai` field from `ModelResult` returns
  5. Update frontend: change `MultiModelResult` component to show 2 cards instead of 3
  6. Timeline: 2-3 hours to remove and test all references

**Gemini API model version pinning (gemini-3-pro-image-preview):**
- Risk: Model may be deprecated or replaced. No explicit version locking in code
- Impact: If Google retires model, all image generation fails with 404 errors
- Recommendations:
  1. Add version constant: `GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview"` in `config.ts`
  2. Monitor: subscribe to Google AI Studio deprecation notices
  3. Test: run `npm run test` quarterly to detect model retirements

**@google/genai SDK stability (maintained but relatively new):**
- Risk: SDK is 2 years old, fewer Stack Overflow answers than OpenAI SDK
- Impact: Bugs in SDK harder to diagnose, retry logic relies on string matching error messages
- Recommendations:
  1. Add detailed error logging: log full error object, not just `error.message`
  2. Implement fallback to REST API if SDK fails (create `google-client-rest.ts` using `fetch`)
  3. Add error type guards: distinguish `DEADLINE_EXCEEDED` from `INVALID_REQUEST` more carefully

**Multer storage without lifecycle management:**
- Risk: Uploaded files persist forever in `uploads/` directory
- Impact: Disk space fills up over time (each design ~500KB PNG × 1000 designs = 500MB)
- Scaling path:
  1. Add cleanup script: `scripts/cleanup-old-uploads.ts` runs weekly, deletes files older than 30 days
  2. Cloud storage migration: move `uploads/` to S3/Google Cloud Storage with auto-delete policies
  3. Database: add `expires_at` timestamp to `reference_images`, soft-delete (don't physically delete files)

## Missing Critical Features

**No design export/download:**
- Problem: Users can generate designs but cannot save PNG with high quality or metadata
- Blocks: Client cannot build "Save Design" workflow beyond storing in DB
- Files: `client/src/pages/home.tsx` (ResultDisplay component), `server/routes.ts` (no `/api/designs/:id/download` endpoint)
- Impact: Designs are ephemeral, user loses them on page refresh if not explicitly saved
- Fix approach:
  1. Add endpoint: `GET /api/design-projects/:id/download` returns PNG file with `Content-Disposition: attachment`
  2. Add button in `ResultDisplay`: "Download Sketch" triggers fetch to `/api/design-projects/:id/download`, saves as `design_{id}.png`
  3. Add timestamp metadata: burn `Created: 2025-02-28` text into PNG before download

**No design versioning/collaboration:**
- Problem: Users cannot compare iterations side-by-side or rollback to previous versions
- Blocks: Multi-user feedback workflow, design review process
- Files: `server/routes.ts` (design_iterations table has structure but no comparison endpoint), `client/src/pages/home.tsx` (no iteration viewer)
- Impact: Each edit replaces previous version in UI. Hard to track what changed
- Fix approach:
  1. Add endpoint: `GET /api/design-projects/:id/iterations` returns array of `{ iteration_number, created_at, image_url, edit_prompt }`
  2. Add UI: timeline slider in `ResultDisplay` to scrub through iterations
  3. Add comparison: side-by-side viewer for selected iteration vs current

**No admin panel for configuration:**
- Problem: Domain constants (POLKI_SIZE_DESCRIPTIONS, BRAND_RULES, PRICE_BAND_BUDGET) are code-only. Changes require code redeploy
- Blocks: Non-technical users cannot update brand guidelines, pricing tiers, or polki descriptions
- Files: All constants in `server/routes.ts` and `client/src/lib/jewellery-logic.ts`
- Impact: Each guideline change = code deploy = downtime
- Fix approach:
  1. Create `/admin` page (requires authentication)
  2. Add database tables: `admin_config(key: string, value: json, updated_at: timestamp)`
  3. Move constants to database, add `/api/admin/config/:key` GET/PUT endpoints
  4. Cache in memory with 5-minute invalidation

## Test Coverage Gaps

**No unit tests for server endpoints:**
- What's not tested: All 30+ API endpoints in `server/routes.ts`. No test coverage for error cases (malformed input, missing files, API failures)
- Files: `tests/` directory has only 2 files: `assortment.spec.ts` (7 Playwright E2E tests), `prompt-validation.spec.ts` (unclear purpose)
- Risk: Regression bugs introduced silently. Cannot refactor with confidence
- Priority: **High** — impacts data integrity, payment calculations, AI generation

**No unit tests for AI prompt builders:**
- What's not tested: `buildImagePromptJSON()`, `buildCADPromptJSON()` functions. No tests for prompt length, special character handling, or JSON validity
- Files: `server/google-client.ts` (lines 193-? buildImagePromptJSON), `server/routes.ts` (no builders, calls google-client functions)
- Risk: Prompt changes could silently break image generation (e.g., JSON parsing errors, missing fields)
- Priority: **High** — AI output quality depends on prompts

**No unit tests for costing calculations:**
- What's not tested: `generateCostingReport()`, `calculatePolki()`, `calculateDiamond()`, `splitBudget()` functions with various input combinations
- Files: `server/costing.ts` (no test coverage)
- Risk: Incorrect cost estimates could mislead customers (e.g., missing 10% polki surcharge, wrong gold rate multiplier)
- Priority: **Critical** — affects revenue calculations

**No tests for vector search results:**
- What's not tested: `searchSimilarVectors()` ranking and relevance. No tests for edge cases (empty vector store, NaN embeddings, duplicate items)
- Files: `server/vector-store.ts` (no test coverage), `server/routes.ts` (line 637 uses searchSimilarVectors)
- Risk: Similar designs could be irrelevant, degrading RAG quality
- Priority: **Medium** — affects user experience but not data integrity

**No tests for multi-model fallback logic:**
- What's not tested: `firstSuccessfulUrl()`, `toModelResult()`, error prioritization when 2+ models fail
- Files: `server/routes.ts` (lines 753-821), no tests
- Risk: If Gemini and OpenAI both fail, Grok result might be selected incorrectly (e.g., low-quality Grok image chosen over high-quality stored PNG)
- Priority: **Medium** — affects output quality

**No tests for form validation/cascades:**
- What's not tested: Product Segment → Category → Price Band cascading. Stone selection disabling when no stones selected. Motif category filter accuracy
- Files: `client/src/components/design-form.tsx`, `client/src/pages/modify.tsx`, `client/src/pages/cad-comparison.tsx`
- Risk: Users could select invalid combinations (e.g., CLO theme + Animal & Bird motif, which is blocked but how is it blocked?)
- Priority: **Medium** — affects UX validation

---

*Concerns audit: 2025-02-28*
