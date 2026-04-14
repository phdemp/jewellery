# Technology Stack: Feedback & Prompt Learning

**Project:** Raniwala 1881 — Design Brain: Feedback-Driven Prompt Learning
**Researched:** 2026-04-14
**Scope:** Brownfield addition to existing Express + React + PostgreSQL + pgvector + Gemini stack

---

## Constraint Summary

The PROJECT.md explicitly mandates: "No new dependencies — use existing libraries." This research
validates that the existing stack is fully capable of building this feature without any additions,
and identifies precisely which existing pieces handle which responsibilities.

---

## Recommended Stack

### New Database Table: `design_feedback`

| Column | Type | Why |
|--------|------|-----|
| `id` | `varchar PK (UUID)` | Matches existing table pattern |
| `design_project_id` | `varchar FK → design_projects.id` | Associates feedback with the design that prompted it |
| `feedback_text` | `text NOT NULL` | Free-form designer text — the raw input |
| `category` | `text NOT NULL` | Design category (e.g. "Necklace Set") — primary filter key |
| `theme` | `text NOT NULL` | Theme code (e.g. "BRP") — secondary filter key |
| `tags` | `text[] NOT NULL` | Parameter tags: `["stones", "motifs", "proportions", "style"]` — for tag-scoped retrieval |
| `embedding_vector` | `vector(3072)` | Gemini embedding of feedback_text — for cosine similarity retrieval |
| `created_at` | `timestamp` | Recency signal for future weighting |

**Drizzle ORM schema pattern** (matches existing `customType` approach in `shared/schema.ts`):

```typescript
// Reuse the existing `vector` customType already defined in shared/schema.ts
// Do NOT redefine it — import the pattern from the same file

export const designFeedback = pgTable("design_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designProjectId: varchar("design_project_id")
    .notNull()
    .references(() => designProjects.id, { onDelete: "cascade" }),
  feedbackText: text("feedback_text").notNull(),
  category: text("category").notNull(),
  theme: text("theme").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  embeddingVector: vector("embedding_vector"), // same customType as reference_images
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Confidence: HIGH** — directly mirrors the existing `referenceImages` and `designIterations` table
patterns already in `shared/schema.ts`. The `customType` vector definition is reused, not duplicated.

---

### Schema Migration

| Technology | Version | Rationale |
|------------|---------|-----------|
| `drizzle-kit push` | 0.31.4 (existing) | `npm run db:push` pushes schema diff — zero new tooling needed |

**Pattern:** Add the new table to `shared/schema.ts`, run `npm run db:push`. The pgvector extension
is already installed in the database. No migration files to write manually.

**Confidence: HIGH** — verified against existing project scripts and Drizzle ORM docs.

**Do NOT use:** `drizzle-kit generate` + `drizzle-kit migrate` (migration file workflow). The project
uses `db:push` (direct schema sync, dev-mode pattern). Switching workflows would be disruptive.

---

### Embedding: Feedback Text

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `generateTextEmbedding()` | existing | Convert feedback text to 3072-dim vector | Already exists in `server/google-client.ts`. Uses `gemini-embedding-001` (the current model — `text-embedding-004` was deprecated 2026-01-14 per the codebase comment). Zero new code needed. |

**Pattern:** Call `generateTextEmbedding(feedbackText)` immediately after saving feedback, then
update the row with the embedding. This mirrors the existing reference image flow exactly.

**Confidence: HIGH** — function already exists and works in production.

**Do NOT use:** OpenAI embeddings (billing limit hit), sentence-transformers (no Python runtime),
or any third-party embedding service. Gemini embedding-001 is the only active embedding pipeline.

---

### Vector Retrieval: Feedback for Prompt Injection

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `db.execute(sql\`...\`)` | existing | Raw SQL with pgvector `<=>` cosine operator | Same pattern as `searchSimilarVectors()` in `server/vector-store.ts` |

**Pattern:** New function `searchFeedbackVectors(queryEmbedding, category, theme, tags?)` that:
1. Filters by `category = $1 AND theme = $2` (hard filter — only relevant product type)
2. Orders by `embedding_vector <=> $queryVector::vector` (cosine similarity)
3. Returns all matching rows (no topK limit — feedback corpus is small, PROJECT.md says inject all)

```typescript
// In a new server/feedback-store.ts (mirrors vector-store.ts structure)
export async function searchFeedbackVectors(
  queryEmbedding: number[],
  category: string,
  theme: string,
): Promise<DesignFeedback[]> {
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  const results = await db.execute(sql`
    SELECT id, feedback_text, tags, created_at,
           1 - (embedding_vector <=> ${vectorStr}::vector) as similarity
    FROM design_feedback
    WHERE embedding_vector IS NOT NULL
      AND category = ${category}
      AND theme = ${theme}
    ORDER BY embedding_vector <=> ${vectorStr}::vector
  `);
  return results.rows as DesignFeedback[];
}
```

**Confidence: HIGH** — identical pattern to production `searchSimilarVectors()` in `vector-store.ts`.

**Do NOT add an HNSW index** at this stage. Feedback corpus will be dozens to low hundreds of rows
per category/theme. Sequential scan at that scale is faster than index overhead. Add HNSW if corpus
exceeds ~10,000 rows.

---

### Prompt Injection: How Feedback Enriches Generation

| Hook Point | File | What to Modify |
|------------|------|---------------|
| `buildDesignContext()` | `server/google-client.ts` | Accept `feedbackSnippets: string[]` as new optional param |
| `buildImagePromptJSON()` | `server/google-client.ts` | Append a `"designer_feedback"` key to the JSON spec |

**Pattern:** In `server/routes.ts`, before calling `buildDesignContext()`:
1. Embed the generation query using `generateTextEmbedding(queryText)`
2. Call `searchFeedbackVectors(embedding, category, theme)`
3. Map results to `feedbackText[]` strings
4. Pass them into `buildDesignContext()` as `feedbackSnippets`

The JSON prompt spec gets a new key:
```json
{
  "category": "Necklace Set",
  "designer_feedback": [
    "Make the polki stones larger, they looked too small last time",
    "Add more jhaalar at the bottom"
  ]
}
```

**Confidence: HIGH** — the existing JSON prompt builder pattern is already defined in codebase.
The JSON approach (vs prose injection) is consistent with the existing `buildImagePromptJSON()`
function and won't bloat the prompt.

---

### API Layer: New Endpoints

| Method | Path | Purpose | Pattern to Follow |
|--------|------|---------|-------------------|
| `POST` | `/api/feedback` | Create feedback + trigger async embedding | Same as `POST /api/reference-images` |
| `GET` | `/api/feedback` | List all feedback (management page) | Same as `GET /api/design-projects` |
| `GET` | `/api/feedback/:id` | Single feedback record | Same as `GET /api/design-projects/:id` |
| `PATCH` | `/api/feedback/:id` | Edit feedback text + re-embed | New, but trivial CRUD |
| `DELETE` | `/api/feedback/:id` | Delete feedback record | Same as `DELETE /api/reference-images/:id` |

**Embedding timing:** Embed synchronously before returning from `POST /api/feedback`. The text is
short (1-3 sentences) so `generateTextEmbedding()` will complete in ~1-2 seconds — acceptable for
a feedback submission that already expects a server round-trip.

**Do NOT:** Queue embedding asynchronously (adds complexity the project doesn't need). Do NOT use
a job queue like BullMQ or pg-boss (no new dependencies rule).

**Confidence: HIGH** — follows established routing patterns in `server/routes.ts`.

---

### Storage Layer: DatabaseStorage Extension

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `server/storage.ts` — `DatabaseStorage` class | existing | Add feedback CRUD methods | Matches the IStorage interface extension pattern already used for B2C sales and stock items |

**New IStorage methods to add:**
```typescript
createFeedback(data: InsertDesignFeedback): Promise<DesignFeedback>;
getFeedback(id: string): Promise<DesignFeedback | undefined>;
getAllFeedback(): Promise<DesignFeedback[]>;
updateFeedback(id: string, data: Partial<DesignFeedback>): Promise<void>;
deleteFeedback(id: string): Promise<void>;
getFeedbackByProject(designProjectId: string): Promise<DesignFeedback[]>;
```

**Confidence: HIGH** — direct extension of existing pattern.

---

### Frontend: Feedback Input Component

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react-hook-form` | 7.66.0 (existing) | Feedback form state | Mandatory by CLAUDE.md code style rules |
| `zod` | 3.25.76 (existing) | Feedback schema validation | Mandatory — no uncontrolled inputs |
| `@hookform/resolvers` | 3.10.0 (existing) | Connect RHF + Zod | Already installed |
| shadcn/ui `Textarea` | existing | Multi-line feedback input | Already in `components/ui/` |
| shadcn/ui `Checkbox` | existing | Tag selection (stones, motifs, etc.) | Already in `components/ui/` |
| shadcn/ui `Badge` | existing | Display selected tags | Already in `components/ui/` |

**Zod schema for the feedback form:**
```typescript
const feedbackSchema = z.object({
  feedbackText: z.string().min(10, "Please write at least 10 characters").max(500),
  tags: z.array(z.string()).min(1, "Select at least one category"),
});
```

**Do NOT use:** Uncontrolled textarea, raw `useState` for form state. Must use RHF + Zod per
project code style rules.

**Confidence: HIGH** — all components exist, pattern established in `design-form.tsx`.

---

### Frontend: Data Fetching for Feedback

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@tanstack/react-query` | 5.60.5 (existing) | Feedback mutations + queries | Mandatory — all data fetching goes through TanStack Query |
| `sonner` | 2.0.7 (existing) | Toast on feedback saved/error | Mandatory — existing notification system |

**Pattern for feedback submission:**
```typescript
const feedbackMutation = useMutation({
  mutationFn: (data: FeedbackInput) => submitFeedback(data),
  onSuccess: () => {
    toast.success("Feedback saved — will improve future generations");
    queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
  },
  onError: (err) => toast.error("Failed to save feedback"),
});
```

**No optimistic updates needed** — feedback submission is a write-and-forget from the UI
perspective. The user doesn't need to see the feedback list update instantly.

**Confidence: HIGH** — standard TanStack Query v5 mutation pattern, matches existing codebase usage.

---

### Frontend: Feedback Management Page

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| wouter | 3.3.5 (existing) | Route `/feedback` | Existing router |
| shadcn/ui `Card`, `Table` | existing | Display feedback list | Consistent with other pages |
| `date-fns` | 3.6.0 (existing) | Format `created_at` timestamps | Already installed, used elsewhere |

**No new libraries needed.** The management page follows the same visual pattern as `references.tsx`
(list view with delete actions).

**Confidence: HIGH.**

---

## Alternatives Considered and Rejected

| Category | Rejected Option | Why Rejected |
|----------|----------------|--------------|
| Embedding | OpenAI `text-embedding-3-large` | OpenAI billing hard limit hit; Gemini embedding already works |
| Embedding | Separate embedding service (Cohere, Voyage AI) | Violates no-new-dependencies constraint |
| Vector store | Separate Qdrant/Weaviate/Pinecone | Violates no-new-dependencies; pgvector already handles this at the same scale |
| Async embedding | BullMQ / pg-boss job queue | Overkill for a single short-text embedding call (~1-2s); adds complexity |
| Feedback format | Star ratings / thumbs up-down | Explicitly out of scope per PROJECT.md |
| Multi-user feedback | Reviewer roles, approval workflows | Explicitly out of scope per PROJECT.md |
| Advanced retrieval | HyperRAG, GraphRAG, hybrid BM25+vector | The feedback corpus is small (dozens of rows per category/theme). Simple cosine similarity over category+theme filter is the right complexity level. Hybrid retrieval is designed for corpora of thousands of documents. |
| HNSW index on feedback | `index().using('hnsw', ...)` | Unnecessary at expected corpus size (<1000 rows). HNSW index build overhead exceeds query savings below ~10K vectors. |
| Feedback on per-model outputs | Track Gemini vs OpenAI vs Grok separately | Explicitly out of scope per PROJECT.md; feedback is on the design, not the model |

---

## Library Versions Confirmed

All versions are from the existing `package.json` — no new dependencies required.

| Library | Version in package.json | Status |
|---------|------------------------|--------|
| `drizzle-orm` | 0.39.3 | Active |
| `drizzle-kit` | 0.31.4 | Active |
| `drizzle-zod` | 0.7.0 | Active |
| `@google/genai` | 1.32.0 | Active (embedding-001) |
| `react-hook-form` | 7.66.0 | Active |
| `zod` | 3.25.76 | Active |
| `@hookform/resolvers` | 3.10.0 | Active |
| `@tanstack/react-query` | 5.60.5 | Active |
| `sonner` | 2.0.7 | Active |
| `wouter` | 3.3.5 | Active |
| `pg` | 8.16.3 | Active |

---

## Implementation Order (Stack Dependencies)

1. **Schema first** (`shared/schema.ts`) — defines types used everywhere
2. **`npm run db:push`** — creates table in DB before any server code runs
3. **`server/feedback-store.ts`** — vector search function (new file, mirrors `vector-store.ts`)
4. **`server/storage.ts`** — add IStorage methods + DatabaseStorage implementations
5. **`server/routes.ts`** — add 5 CRUD endpoints + embed-on-create logic
6. **Prompt injection** (`server/google-client.ts` + route handlers) — hook into existing prompt builders
7. **`client/src/lib/api.ts`** — add typed fetch wrappers
8. **Inline feedback components** — `FeedbackForm` below `ResultDisplay` on all 4 pages
9. **`client/src/pages/feedback.tsx`** — management page
10. **App.tsx + layout.tsx** — register route + nav link

---

## Sources

- [Drizzle ORM pgvector guide](https://orm.drizzle.team/docs/guides/vector-similarity-search) — vector column API, HNSW index syntax (HIGH confidence, official docs)
- [pgvector GitHub](https://github.com/pgvector/pgvector) — HNSW index parameters, 3072-dim support (HIGH confidence, official source)
- [RAG metadata filtering pattern](https://markaicode.com/rag-metadata-filtering-document-tags/) — hard filter + semantic search pattern (MEDIUM confidence, verified against existing `searchSimilarVectors` implementation)
- [TanStack Query v5 mutations](https://tanstack.com/query/v5/docs/react/guides/mutations) — `useMutation` API (HIGH confidence, official docs)
- [shadcn/ui React Hook Form guide](https://ui.shadcn.com/docs/forms/react-hook-form) — RHF + Zod + shadcn/ui form pattern (HIGH confidence, official docs)
- Existing codebase (`shared/schema.ts`, `server/vector-store.ts`, `server/storage.ts`, `server/google-client.ts`) — all patterns verified by direct inspection (HIGH confidence)
