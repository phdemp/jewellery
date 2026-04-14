# Architecture Patterns: Feedback-Driven Prompt Learning

**Domain:** Feedback collection + RAG-based prompt enrichment for AI image generation
**Researched:** 2026-04-14
**Milestone:** Feedback & Prompt Learning — added to existing Express + React + PostgreSQL + pgvector + Gemini app

---

## System Overview

This milestone adds a feedback memory layer on top of the existing RAG pipeline. The existing pipeline is:

```
User Input → Text Embedding → pgvector Search → Reference Analysis → Prompt Assembly → Image Generation
```

After this milestone, the pipeline becomes:

```
User Input → Text Embedding → [pgvector Search (refs) + pgvector Search (feedback)] → Prompt Assembly (with injected feedback) → Image Generation
                                                    ↑
                                     Designer submits feedback on any generated image
                                     Feedback embedded + stored in new `design_feedback` table
```

The two pipelines are independent at retrieval time and merge only at prompt assembly. This keeps the feedback system decoupled from the reference image system.

---

## Component Map

### Existing Components (unchanged)

| Component | File | Role |
|-----------|------|------|
| Embedding function | `server/google-client.ts` | `generateTextEmbedding()` — Gemini text-embedding-004, 3072-dim |
| Vector search | `server/vector-store.ts` | `searchSimilarVectors()` — cosine similarity with optional theme filter |
| Prompt assembly | `server/google-client.ts` | `buildImagePromptJSON()` — assembles JSON spec from design context |
| Prompt prefix | `server/routes.ts` | `BRAND_RULES` — prepended to all generation prompts |
| Generation routes | `server/routes.ts` | `/api/generate-design`, `/api/modify-design`, `/api/generate-cad-comparison`, `/api/generate-marketing` |
| DB schema | `shared/schema.ts` | Single source of truth — Drizzle ORM + Zod |
| Storage class | `server/storage.ts` | `DatabaseStorage` — all CRUD lives here |

### New Components (this milestone)

| Component | File (to create) | Role |
|-----------|-----------------|------|
| `design_feedback` table | `shared/schema.ts` (extend) | Stores feedback text, tags, design association, embedding vector |
| Feedback vector store | `server/feedback-vector-store.ts` | `addFeedbackVector()`, `searchSimilarFeedback()` — parallel to reference vector store |
| Feedback storage methods | `server/storage.ts` (extend) | `createFeedback()`, `getAllFeedback()`, `updateFeedback()`, `deleteFeedback()` on `DatabaseStorage` |
| Feedback API endpoints | `server/routes.ts` (extend) | `POST /api/feedback`, `GET /api/feedback`, `PUT /api/feedback/:id`, `DELETE /api/feedback/:id` |
| Prompt enrichment hook | `server/routes.ts` (extend) | `getRelevantFeedback(category, theme, queryEmbedding)` — called inside each generation endpoint before prompt assembly |
| Feedback submission UI | `client/src/components/feedback-form.tsx` | Inline text box + tag multi-select below result images |
| Feedback management page | `client/src/pages/feedback.tsx` | Browse/edit/delete all stored feedback |
| API wrapper | `client/src/lib/api.ts` (extend) | Typed fetch wrappers for feedback endpoints |

---

## Data Flow: Feedback Submission

```
1. Designer views generated image on any of the 4 generation pages
2. Types feedback text in inline FeedbackForm component
3. Optionally selects tag categories (stones, motifs, proportions, style, etc.)
4. Clicks "Save Feedback"

5. POST /api/feedback
   Body: { designProjectId, text, tags[], category, theme }

6. Server: generateTextEmbedding(text) → 3072-dim float[]

7. INSERT into design_feedback:
   { id, designProjectId, text, tags, category, theme, embeddingVector, createdAt }

8. Return { id, text, tags } — UI shows confirmation toast
```

**Direction:** User action → API → Embedding → DB write. No generation is triggered. Feedback is stored asynchronously relative to generation.

---

## Data Flow: Feedback Retrieval (Prompt Enrichment)

```
1. User submits generation request (any of the 4 pages)

2. Existing flow: generateTextEmbedding(queryText) → searchSimilarVectors (reference images)

3. NEW — parallel to step 2:
   getRelevantFeedback(category, theme, queryEmbedding)
   → SQL: SELECT text, tags FROM design_feedback
          WHERE category = $1 AND theme = $2    ← hard filter (same product type)
          ORDER BY embedding_vector <=> $3        ← cosine similarity ranking
   → Returns all matching rows (no topK cap — corpus is small)

4. Prompt assembly: buildImagePromptJSON(context, extras)
   → Existing: reference image style details injected into context.similarDesigns
   → NEW: feedback text blocks appended to customNotes OR as a dedicated
          "designer_feedback" key in the JSON spec

5. BRAND_RULES + imagePrompt + feedbackBlock → image generation
```

**Direction:** Query embedding → DB read (filtered + ranked) → text strings → prompt string. Pure read path, no side effects.

---

## Component Boundaries

### What Each Component Owns

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI Layer (client/)                                                 │
│  ┌────────────────────┐   ┌───────────────────────────────────────┐ │
│  │  FeedbackForm      │   │  FeedbackPage (/feedback)             │ │
│  │  - text input      │   │  - table view of all feedback         │ │
│  │  - tag multi-select│   │  - inline edit / delete               │ │
│  │  - injected below  │   │  - filter by category, theme, tag     │ │
│  │    ResultDisplay   │   └───────────────────────────────────────┘ │
│  └──────────┬─────────┘                                             │
│             │ typed fetch via api.ts                                │
└─────────────┼───────────────────────────────────────────────────────┘
              │
┌─────────────┼───────────────────────────────────────────────────────┐
│  API Layer (server/routes.ts)                                        │
│  ┌──────────▼──────────────────────────────────────────────────┐    │
│  │  POST /api/feedback         (submit + embed + store)        │    │
│  │  GET  /api/feedback         (list, filter by cat/theme/tag) │    │
│  │  PUT  /api/feedback/:id     (update text or tags)           │    │
│  │  DELETE /api/feedback/:id   (delete + remove embedding)     │    │
│  │                                                             │    │
│  │  Existing generation endpoints: receive enriched context    │    │
│  │  via getRelevantFeedback() called before prompt assembly    │    │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Domain Layer (server/)                                              │
│  ┌────────────────────┐   ┌────────────────────────────────────┐    │
│  │  feedback-vector   │   │  storage.ts (DatabaseStorage)      │    │
│  │  -store.ts         │   │  + feedback CRUD methods           │    │
│  │  - addFeedbackVec  │   │  createFeedback()                  │    │
│  │  - searchFeedback  │   │  getAllFeedback()                   │    │
│  │    (category+theme │   │  updateFeedback()                  │    │
│  │     filter +       │   │  deleteFeedback()                  │    │
│  │     cosine rank)   │   └────────────────────────────────────┘    │
│  └────────────────────┘                                              │
│                                                                      │
│  google-client.ts (existing — untouched)                            │
│  - generateTextEmbedding() — called by feedback endpoint to embed   │
│  - buildImagePromptJSON() — receives feedbackNotes as extra field   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Data Layer (PostgreSQL + pgvector)                                  │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  design_feedback table (new)                               │     │
│  │  - id           varchar PK (UUID)                         │     │
│  │  - design_project_id  varchar FK → design_projects.id     │     │
│  │  - text         text NOT NULL                             │     │
│  │  - tags         text[] (e.g. ["stones","proportions"])    │     │
│  │  - category     text  (e.g. "Necklace Set")               │     │
│  │  - theme        text  (e.g. "BRP")                        │     │
│  │  - embedding_vector  vector(3072)                         │     │
│  │  - created_at   timestamp                                 │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  reference_images (existing — unchanged)                            │
│  design_projects  (existing — unchanged)                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Communication Rules

- `FeedbackForm` talks only to `POST /api/feedback` via `api.ts`
- `FeedbackPage` talks only to `GET`, `PUT`, `DELETE /api/feedback` via `api.ts`
- Generation endpoints call `getRelevantFeedback()` (a server-side helper in routes.ts) before prompt assembly — this is an internal function call, not an HTTP request
- `getRelevantFeedback()` calls `searchSimilarFeedback()` in `feedback-vector-store.ts`
- `feedback-vector-store.ts` executes raw SQL against `design_feedback` (mirrors the pattern in `vector-store.ts`)
- `google-client.ts` does not know about feedback — it receives feedback text as part of `customNotes` or via an `extras` key injected by the route handler

---

## Prompt Injection Pattern

The cleanest injection point is the `extras` object already passed to `buildImagePromptJSON()`. Feedback text becomes a dedicated key in the JSON spec:

```typescript
// In the generation route, before buildImagePromptJSON():
const relevantFeedback = await getRelevantFeedback(category, theme, queryEmbedding);
if (relevantFeedback.length > 0) {
  extras.designer_feedback = relevantFeedback.map(f => f.text);
}

// buildImagePromptJSON() already merges extras into the spec JSON:
// { ..., "designer_feedback": ["Polki too small", "Peacock proportions too dominant"] }
```

Gemini receives this as structured instruction within the JSON spec — it treats the designer_feedback array as prior constraints to respect. The BRAND_RULES prefix already primes Gemini to follow structured instructions.

**Why not a separate prompt section:** Appending a prose "Designer Feedback History:" block risks diluting the instruction weight. JSON spec keys carry equal weight to other design parameters in the compact format.

**Why all matching feedback (not topK):** The corpus will be small (dozens to low hundreds of entries per category/theme combination). Injecting all semantically relevant feedback gives Gemini the full learned preference set. Context window is not a bottleneck — the feedback text corpus will be far smaller than the BRAND_RULES prefix.

---

## Schema Design

```sql
CREATE TABLE design_feedback (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  design_project_id  VARCHAR REFERENCES design_projects(id) ON DELETE SET NULL,
  text          TEXT NOT NULL,
  tags          TEXT[],          -- ["stones","motifs","proportions","style","layout"]
  category      TEXT,            -- mirrors design_projects.category for hard filter
  theme         TEXT,            -- mirrors design_projects.theme for hard filter
  embedding_vector  vector(3072),
  created_at    TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX ON design_feedback USING ivfflat (embedding_vector vector_cosine_ops)
  WITH (lists = 10);             -- small corpus — 10 lists is appropriate
```

**Why `category` and `theme` are denormalized:** The retrieval query needs to hard-filter by both before ranking by vector similarity. Joining to `design_projects` adds a join on every generation call — denormalization avoids this and the values are stable (they don't change after project creation).

**Why `design_project_id` nullable on delete:** If a project is deleted, feedback should be preserved — it represents designer preferences that outlive any single project.

---

## Retrieval Query Pattern

```sql
-- All feedback for same category + theme, ranked by semantic similarity to current query
SELECT text, tags, 1 - (embedding_vector <=> $queryVec::vector) AS similarity
FROM design_feedback
WHERE category = $category
  AND theme = $theme
  AND embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> $queryVec::vector;
-- No LIMIT — inject everything. Corpus is small per category/theme cell.
```

**Optional tag filter:** If the generation has specific stones selected, filter to feedback tagged `["stones"]` first. This is a future optimization — start without it.

---

## Suggested Build Order

Dependencies determine order. Each phase unblocks the next.

### Phase 1: Schema + Storage Foundation
**Build:** `design_feedback` table in `shared/schema.ts` + Zod schemas + Drizzle migration (`npm run db:push`) + `IStorage` extension + `DatabaseStorage` feedback methods.

**Why first:** All other components depend on this. Nothing can be tested without the table existing. The Zod schema also defines the API contract for Phase 2.

**No external dependencies. Can be validated immediately** by running `npm run check` and `npm run db:push`.

### Phase 2: Feedback Vector Store
**Build:** `server/feedback-vector-store.ts` with `addFeedbackVector(id, embedding, metadata)` and `searchSimilarFeedback(queryEmbedding, category, theme)`.

**Why second:** Mirrors the existing `vector-store.ts` pattern exactly — safe, low-risk, no unknowns. Required by both the submission endpoint (Phase 3) and the retrieval enrichment (Phase 4).

**Validation:** Unit-testable in isolation with mock embeddings.

### Phase 3: Feedback API Endpoints + Embedding
**Build:** `POST /api/feedback`, `GET /api/feedback`, `PUT /api/feedback/:id`, `DELETE /api/feedback/:id` in `server/routes.ts`. The POST endpoint calls `generateTextEmbedding()` and `addFeedbackVector()`.

**Why third:** Enables data entry for testing Phase 4. API contract is defined by the Zod schema from Phase 1.

**Validation:** Can test via curl or Postman — submit feedback, verify row in DB with embedding.

### Phase 4: Prompt Enrichment Hook
**Build:** `getRelevantFeedback(category, theme, queryEmbedding)` helper in `routes.ts`. Inject into all 4 generation endpoints before `buildImagePromptJSON()` call via `extras.designer_feedback`.

**Why fourth:** Requires stored feedback data (Phase 3) to observe effect. This is the highest-value component — it closes the learning loop. Requires careful testing that existing generation still works when no feedback exists (empty array → no injection).

**Validation:** Generate with same parameters before and after submitting feedback — observe prompt log changes in server console (all prompts are already logged).

### Phase 5: UI Components
**Build:** `FeedbackForm` inline component (below ResultDisplay on all 4 pages) + `/feedback` management page + nav link + `api.ts` typed wrappers.

**Why fifth:** UI is additive — the system works without it for internal testing. Building UI last means the API is stable and can be tested independently. Also separates frontend breakages from backend breakages during development.

**Validation:** End-to-end — submit feedback through UI, observe it in management page, generate a new design, check server logs for feedback injection.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Storing Feedback in the Reference Images Table
**What goes wrong:** Conflates two distinct data types — reference images are visual exemplars, feedback is textual designer preference. They have different retrieval semantics (image similarity vs. preference similarity) and different lifecycles.
**Instead:** Use a dedicated `design_feedback` table. The vector store layer is parallel, not shared.

### Anti-Pattern 2: Injecting Feedback as Prose After BRAND_RULES
**What goes wrong:** Adding a "Designer Notes from past sessions:" block as free text after BRAND_RULES creates ambiguous instruction priority. Gemini may de-prioritize it as contextual background rather than hard constraint.
**Instead:** Inject feedback as a structured key within the JSON spec (`designer_feedback: [...]`). JSON keys receive equal treatment to category, motifs, and stone specs.

### Anti-Pattern 3: Reembedding Feedback on Every Update
**What goes wrong:** The embedding represents the semantic meaning of the text. If the text changes (user corrects a typo), the embedding must be regenerated. If only tags change, no reembedding needed.
**Instead:** `PUT /api/feedback/:id` checks whether `text` changed — reembeds only if text is different. Tag-only updates skip the embedding call.

### Anti-Pattern 4: TopK Cutoff on Feedback Retrieval
**What goes wrong:** Setting topK=3 on feedback (as done for reference images) discards potentially relevant designer instructions. Reference image topK=3 is a quality filter for verbose image analysis payloads. Feedback text is compact.
**Instead:** No LIMIT on the feedback query. Return all entries that pass the category+theme hard filter. The prompt overhead is negligible (each feedback entry is 10-50 words).

### Anti-Pattern 5: Making Feedback Injection Blocking
**What goes wrong:** If `getRelevantFeedback()` throws (DB connection issue, malformed embedding), the entire generation call fails. Feedback injection is enhancement, not core requirement.
**Instead:** Wrap `getRelevantFeedback()` in try/catch inside the generation route. On error, log a warning and proceed with empty feedback — generation continues unimpaired.

---

## Scalability Considerations

| Concern | At < 500 feedback entries | At 5,000+ entries | Notes |
|---------|--------------------------|-------------------|-------|
| Query speed | Negligible — sequential scan OK | Add HNSW index or ivfflat | ivfflat with lists=10 is already in schema recommendation |
| Context window | Not a concern — all feedback fits | Filter by top tags first | Designer corpus unlikely to reach 5K without intentional data cleaning |
| Embedding cost | ~$0.0001/entry (Gemini pricing) | Still negligible | Embeddings are generated once per submission |
| UI performance | Trivial | Add pagination to management page | Feedback table will be small for the foreseeable future |

For this project (single designer, one brand, ~16 categories x 9 themes = 144 category/theme cells), the practical maximum feedback per cell is unlikely to exceed 50 entries. No scaling concern in the near term.

---

## Integration Points with Existing Code

| Existing File | Change Required | Risk |
|---------------|----------------|------|
| `shared/schema.ts` | Add `design_feedback` table + Zod schemas | LOW — additive |
| `server/storage.ts` | Add 4 feedback CRUD methods to `IStorage` + `DatabaseStorage` | LOW — additive |
| `server/routes.ts` | Add 4 endpoints + `getRelevantFeedback()` helper + call it in 4 generation endpoints | MEDIUM — touching existing routes |
| `server/google-client.ts` | No change — receives `designer_feedback` via extras, doesn't know origin | NONE |
| `client/src/App.tsx` | Add `/feedback` route | LOW — additive |
| `client/src/components/layout.tsx` | Add "Feedback" nav link | LOW — additive |
| `client/src/lib/api.ts` | Add typed wrappers for feedback endpoints | LOW — additive |
| `client/src/pages/home.tsx` | Add `FeedbackForm` below `ResultDisplay` | LOW — additive |
| `client/src/pages/modify.tsx` | Same as home.tsx | LOW — additive |
| `client/src/pages/cad-comparison.tsx` | Same as home.tsx | LOW — additive |
| `client/src/pages/marketing.tsx` | Same as home.tsx | LOW — additive |

The highest-risk touch point is injecting `getRelevantFeedback()` into the 4 generation endpoints. This must be wrapped in try/catch (see anti-pattern 5) and must not alter the response shape when feedback is empty.

---

## Sources

- [pgvector Guide: Vector Search and RAG in PostgreSQL (Encore Blog)](https://encore.dev/blog/you-probably-dont-need-a-vector-database) — unified table pattern, SQL-native similarity search
- [Dynamic AI Systems: Designing Feedback Loop Architectures (Antler Digital)](https://antler.digital/blog/dynamic-ai-systems-feedback-loop-architectures) — modularity principle, layered build order
- [RAGOps: Operating and Managing RAG Pipelines (arXiv 2506.03401)](https://arxiv.org/html/2506.03401v1) — feedback logging patterns, component observability
- [Context Engineering: RAG, Memory Systems & Dynamic Context (Meta Intelligence 2026)](https://www.meta-intelligence.tech/en/insight-context-engineering) — memory injection at prompt assembly
- [Teaching the model: Designing LLM feedback loops (VentureBeat)](https://venturebeat.com/ai/teaching-the-model-designing-llm-feedback-loops-that-get-smarter-over-time) — structured feedback metadata schema
- [Feedback Loop RAG: Improving Retrieval with User Interactions (MachineLearningPlus)](https://www.machinelearningplus.com/gen-ai/feedback-loop-rag-improving-retrieval-with-user-interactions/) — feedback-loop RAG pattern
- Existing codebase: `server/vector-store.ts`, `server/google-client.ts`, `server/routes.ts`, `shared/schema.ts` — patterns extracted directly from production code
