# Phase 3: Feedback API Endpoints - Research

**Researched:** 2026-04-15
**Domain:** Express.js REST API (CRUD endpoints + Gemini embedding integration)
**Confidence:** HIGH

## Summary

Phase 3 adds five REST endpoints to `server/routes.ts` for feedback CRUD operations, backed by new methods on the `DatabaseStorage` class in `server/storage.ts`. The endpoints POST, GET (with pagination + filters), PUT, and DELETE feedback entries. POST and PUT (when text changes) call `generateTextEmbedding()` from `server/google-client.ts` and then `addFeedbackVector()` / `updateFeedbackVector()` from `server/feedback-vector-store.ts` to store/update the 3072-dim pgvector embedding.

This is a pure backend phase -- no UI changes. Every building block already exists: the `design_feedback` table (Phase 1), the vector store module (Phase 2), the Gemini embedding function, and the Drizzle ORM + Express patterns used throughout the codebase. The work is mechanical: add 6 storage methods, add 5 route handlers, add 5 client-side API wrappers.

**Primary recommendation:** Follow the exact patterns from existing endpoints (reference images CRUD, design projects CRUD) -- `storage.*` methods using Drizzle query builder, route handlers with try/catch + Sentry, typed fetch wrappers in `client/src/lib/api.ts`. Register all feedback routes in a single block before the static wildcard at the bottom of `routes.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | POST /api/feedback -- create feedback entry with text, tags, sentiment, embed text | Storage method `createFeedback()` + route handler calling `generateTextEmbedding()` then `addFeedbackVector()`. Returns 201 with created entry. Validated via `insertDesignFeedbackSchema`. |
| API-02 | GET /api/feedback -- list all feedback with pagination support | Storage method `getAllFeedback(page, limit)` using Drizzle `.offset()` + `.limit()` + `desc(designFeedback.createdAt)`. Returns `{ data: [...], total: N, page, limit }`. |
| API-03 | GET /api/feedback?category=X&theme=Y -- filter by category and/or theme | Same GET endpoint with optional query params. Storage method applies `.where()` conditionally using `and()` combinator from drizzle-orm. |
| API-04 | PUT /api/feedback/:id -- update feedback text, tags, or sentiment (re-embed on text change) | Storage method `updateFeedback(id, data)`. Route handler compares old feedbackText to new -- if changed, calls `generateTextEmbedding()` + `updateFeedbackVector()`. Must set `updatedAt: new Date()` explicitly. |
| API-05 | DELETE /api/feedback/:id -- delete feedback entry and its vector | Storage method `deleteFeedback(id)` using Drizzle delete. Route handler also calls `deleteFeedbackVector(id)` from feedback-vector-store.ts. 404 if not found. |
</phase_requirements>

## Standard Stack

### Core

No new dependencies. Everything is already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express.js | 4.21.2 | HTTP route handlers | Already in use for all 30+ existing endpoints [VERIFIED: codebase] |
| Drizzle ORM | 0.39.3 | Typed SQL queries for feedback CRUD | Already in use for all tables [VERIFIED: codebase] |
| Zod | 3.25.76 | Request body validation | `insertDesignFeedbackSchema` already defined in shared/schema.ts [VERIFIED: codebase] |
| @google/genai | 1.32.0 | `generateTextEmbedding()` for feedback text | Already in use, function exists in google-client.ts [VERIFIED: codebase] |
| pgvector | extension | 3072-dim vector storage | Already installed, feedback-vector-store.ts ready [VERIFIED: codebase] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm (and, eq, desc, sql) | 0.39.3 | Query combinators for filtered + paginated GET | Import `and` for multi-column WHERE clause [VERIFIED: codebase] |
| @sentry/node | 10.46.0 | Error tracking on POST/PUT failures | Wrap Gemini embedding errors with Sentry.captureException [VERIFIED: codebase] |

**Installation:** None needed. All packages already installed.

## Architecture Patterns

### Where to Add Code

```
server/
  routes.ts         # Add 5 route handlers (POST, GET, PUT, DELETE, GET/:id) in a
                    # "Feedback API" section block, BEFORE the static wildcard (line ~2521)
  storage.ts        # Add 6 methods to IStorage + DatabaseStorage:
                    #   createFeedback, getFeedback, getAllFeedback,
                    #   updateFeedback, deleteFeedback, countFeedback
  feedback-vector-store.ts  # Already complete (Phase 2) -- import and use

client/src/lib/
  api.ts            # Add DesignFeedbackEntry interface + 5 fetch wrappers

shared/
  schema.ts         # Already complete (Phase 1) -- no changes needed
```

### Pattern 1: Storage Method (Drizzle CRUD)

**What:** Add methods to `DatabaseStorage` class following the existing pattern. [VERIFIED: server/storage.ts]
**When to use:** All CRUD operations on the `design_feedback` table.
**Example:**

```typescript
// Source: existing pattern from storage.ts lines 71-74, 94-96
import { designFeedback, type DesignFeedback, type InsertDesignFeedback } from "@shared/schema";
import { and, eq, desc, sql, count } from "drizzle-orm";

// CREATE
async createFeedback(data: InsertDesignFeedback): Promise<DesignFeedback> {
  const result = await db.insert(designFeedback).values(data).returning();
  return result[0];
}

// GET by ID
async getFeedback(id: string): Promise<DesignFeedback | undefined> {
  const result = await db.select().from(designFeedback).where(eq(designFeedback.id, id));
  return result[0];
}

// GET all with pagination + optional filters
async getAllFeedback(
  page: number,
  limit: number,
  category?: string,
  theme?: string
): Promise<DesignFeedback[]> {
  const conditions = [];
  if (category) conditions.push(eq(designFeedback.category, category));
  if (theme) conditions.push(eq(designFeedback.theme, theme));

  const query = db.select().from(designFeedback);
  const filtered = conditions.length > 0
    ? query.where(and(...conditions))
    : query;

  return await filtered
    .orderBy(desc(designFeedback.createdAt))
    .offset((page - 1) * limit)
    .limit(limit);
}

// COUNT for pagination metadata
async countFeedback(category?: string, theme?: string): Promise<number> {
  const conditions = [];
  if (category) conditions.push(eq(designFeedback.category, category));
  if (theme) conditions.push(eq(designFeedback.theme, theme));

  const query = db.select({ count: count() }).from(designFeedback);
  const filtered = conditions.length > 0
    ? query.where(and(...conditions))
    : query;

  const result = await filtered;
  return result[0].count;
}

// UPDATE -- MUST set updatedAt explicitly (Phase 1 decision)
async updateFeedback(id: string, data: Partial<DesignFeedback>): Promise<DesignFeedback | undefined> {
  const result = await db
    .update(designFeedback)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(designFeedback.id, id))
    .returning();
  return result[0];
}

// DELETE
async deleteFeedback(id: string): Promise<void> {
  await db.delete(designFeedback).where(eq(designFeedback.id, id));
}
```

### Pattern 2: Route Handler (Express CRUD)

**What:** Add route handlers following existing endpoint patterns. [VERIFIED: server/routes.ts]
**When to use:** All 5 feedback endpoints.
**Example (POST):**

```typescript
// Source: existing pattern from routes.ts line 428-488 (reference-images POST)
// Register BEFORE the static wildcard (currently ~line 2521)

// ── Feedback API ────────────────────────────────────────────────────────────
app.post("/api/feedback", async (req, res) => {
  try {
    const parsed = insertDesignFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid feedback data", details: parsed.error.errors });
    }

    // 1. Create the DB row (without embedding)
    const feedback = await storage.createFeedback(parsed.data);

    // 2. Generate embedding from feedback text
    const embedding = await generateTextEmbedding(feedback.feedbackText);

    // 3. Store embedding vector
    await addFeedbackVector(feedback.id, embedding, feedback.category, feedback.theme);

    res.status(201).json(feedback);
  } catch (error: unknown) {
    Sentry.captureException(error);
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});
```

### Pattern 3: Client API Wrapper

**What:** Typed fetch wrappers in `client/src/lib/api.ts`. [VERIFIED: client/src/lib/api.ts]
**When to use:** All 5 feedback API calls.
**Example:**

```typescript
// Source: existing pattern from api.ts (follows getReferenceImages, deleteReferenceImage pattern)
export interface DesignFeedbackEntry {
  id: string;
  designProjectId: string | null;
  feedbackText: string;
  category: string;
  theme: string;
  tags: string[];
  sentiment: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackListResponse {
  data: DesignFeedbackEntry[];
  total: number;
  page: number;
  limit: number;
}

export async function createFeedback(data: {
  feedbackText: string;
  category: string;
  theme: string;
  tags?: string[];
  sentiment?: "positive" | "corrective";
  designProjectId?: string;
}): Promise<DesignFeedbackEntry> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create feedback");
  }
  return response.json();
}
```

### Anti-Patterns to Avoid

- **Importing from `./vector-store`:** Never import `addVector` / `searchSimilarVectors` from `server/vector-store.ts` -- those target the `reference_images` table. Always use `addFeedbackVector` / `updateFeedbackVector` / `deleteFeedbackVector` from `server/feedback-vector-store.ts`. [VERIFIED: Phase 2 blocker noted in STATE.md]
- **Forgetting `updatedAt` on UPDATE:** Drizzle has no `$onUpdate` trigger. Every `.set()` call in `updateFeedback()` must include `updatedAt: new Date()`. [VERIFIED: Phase 1 decision]
- **Raw SQL for simple queries:** Use Drizzle query builder (`.select().from().where()`) for CRUD. Raw SQL (`db.execute(sql\`...\`)`) is only needed for pgvector operations (already handled by feedback-vector-store.ts). [VERIFIED: codebase pattern]
- **Creating new Multer instances:** Feedback is text-only, no file uploads. Do not import or use Multer for these endpoints. [VERIFIED: CLAUDE.md rule]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request validation | Manual `if (!req.body.text)` checks | `insertDesignFeedbackSchema.safeParse(req.body)` | Zod schema already defined with sentiment enum, proper types [VERIFIED: shared/schema.ts line 235] |
| Text embedding | Custom embedding logic | `generateTextEmbedding(text)` from google-client.ts | Uses Gemini text-embedding-004, 3072-dim, already working [VERIFIED: google-client.ts line 118] |
| Vector CRUD | Direct SQL for vector operations | `addFeedbackVector()` / `updateFeedbackVector()` / `deleteFeedbackVector()` from feedback-vector-store.ts | Phase 2 module handles vector formatting, SQL parameterization [VERIFIED: feedback-vector-store.ts] |
| Pagination math | Custom offset calculation | Drizzle `.offset((page - 1) * limit).limit(limit)` | Standard pattern, no edge-case bugs [VERIFIED: drizzle-orm docs] |
| Error capture | Console-only error logging | `Sentry.captureException(error)` | Already integrated in all endpoints [VERIFIED: routes.ts pattern] |

## Common Pitfalls

### Pitfall 1: Embedding Failure Breaks POST

**What goes wrong:** `generateTextEmbedding()` throws on Gemini API error, the feedback row exists in DB but has no embedding, subsequent searches miss it.
**Why it happens:** Gemini can return transient errors (rate limits, timeouts).
**How to avoid:** The row is created first, then embedding is attempted. If embedding fails, the row still exists with `embedding_vector = null`. This is acceptable -- the row is visible in GET responses and can be re-embedded later. The POST handler should still return the created row (status 201) even if embedding fails, but log the error. Alternatively, let the error propagate as a 500 -- the caller can retry.
**Warning signs:** POST returns 500 but the feedback row actually exists in the DB.
**Recommendation:** Let embedding failure propagate as 500. The client can retry. This is simpler and avoids orphaned rows that are never embedded. The `withRetry` wrapper in google-client.ts already handles transient Gemini errors for image generation. Text embedding is fast (~200ms) and rarely fails. [ASSUMED]

### Pitfall 2: PUT Re-embeds When Only Tags Change

**What goes wrong:** Every PUT call triggers `generateTextEmbedding()`, wasting Gemini API calls when only tags or sentiment changed (not the text).
**Why it happens:** No check for whether feedbackText actually changed.
**How to avoid:** Compare old `feedbackText` with new value. Only re-embed if text differs.
**Warning signs:** High Gemini embedding API usage on the PUT endpoint.
**Recommendation:** Fetch the existing row, compare `feedback.feedbackText !== parsed.data.feedbackText`, and only call `generateTextEmbedding()` + `updateFeedbackVector()` if the text changed.

### Pitfall 3: Deletion Leaves Orphaned Vectors

**What goes wrong:** `storage.deleteFeedback(id)` deletes the DB row but the vector is not cleaned up.
**Why it happens:** `deleteFeedbackVector(id)` from feedback-vector-store.ts also deletes the row (it runs `DELETE FROM design_feedback WHERE id = $id`), so calling both would either fail or be redundant.
**How to avoid:** Use `deleteFeedbackVector(id)` as the SOLE delete mechanism. It deletes the entire row including the vector. Do NOT call `storage.deleteFeedback()` separately -- it would be redundant since the row is already gone.
**Warning signs:** "relation does not exist" or "row not found" errors on delete.
**Recommendation:** The DELETE endpoint should call `deleteFeedbackVector(id)` only. OR call `storage.deleteFeedback(id)` only (which deletes the row; the vector column is part of the row so it goes away too). Since `deleteFeedbackVector` uses raw SQL `DELETE FROM design_feedback`, and `storage.deleteFeedback` uses Drizzle `db.delete(designFeedback).where(eq(...))`, they are functionally equivalent. Use `storage.deleteFeedback(id)` for consistency with the CRUD pattern, and skip `deleteFeedbackVector` since the vector is embedded in the same row.

### Pitfall 4: Missing `and` Import from drizzle-orm

**What goes wrong:** TypeScript error when trying to combine multiple WHERE conditions.
**Why it happens:** The existing `storage.ts` imports `eq, desc, sql, inArray` but not `and`. Need to add `and` for the filtered GET query.
**How to avoid:** Add `and` to the import statement in `storage.ts`.
**Warning signs:** `Cannot find name 'and'` TypeScript error.

### Pitfall 5: Pagination Response Missing Total Count

**What goes wrong:** Client cannot render "Page X of Y" or "Showing N results" because the API only returns the page data.
**Why it happens:** Simple `.limit().offset()` returns rows but not the total count.
**How to avoid:** Execute a separate `COUNT(*)` query with the same filters, return `{ data, total, page, limit }`.
**Warning signs:** UI shows infinite scroll or no page indicator.

## Code Examples

### Complete POST Endpoint

```typescript
// Source: derived from existing codebase patterns (routes.ts + google-client.ts + feedback-vector-store.ts)
app.post("/api/feedback", async (req, res) => {
  try {
    const parsed = insertDesignFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid feedback data", details: parsed.error.errors });
    }

    // Create feedback row in DB
    const feedback = await storage.createFeedback(parsed.data);

    // Generate and store embedding
    try {
      const embedding = await generateTextEmbedding(feedback.feedbackText);
      await addFeedbackVector(feedback.id, embedding, feedback.category, feedback.theme);
    } catch (embedError) {
      // Log but don't fail the request -- feedback is saved, embedding can be retried
      console.error("[feedback] Embedding failed for feedback", feedback.id, embedError);
      Sentry.captureException(embedError);
    }

    res.status(201).json(feedback);
  } catch (error: unknown) {
    Sentry.captureException(error);
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});
```

### Complete GET Endpoint (Paginated + Filtered)

```typescript
// Source: derived from existing patterns
app.get("/api/feedback", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const category = req.query.category as string | undefined;
    const theme = req.query.theme as string | undefined;

    const [data, total] = await Promise.all([
      storage.getAllFeedback(page, limit, category, theme),
      storage.countFeedback(category, theme),
    ]);

    res.json({ data, total, page, limit });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});
```

### Complete PUT Endpoint (Conditional Re-embedding)

```typescript
// Source: derived from existing patterns
app.put("/api/feedback/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await storage.getFeedback(id);
    if (!existing) {
      return res.status(404).json({ error: "Feedback not found" });
    }

    // Validate updatable fields
    const { feedbackText, tags, sentiment } = req.body;
    const updateData: Record<string, unknown> = {};
    if (feedbackText !== undefined) updateData.feedbackText = feedbackText;
    if (tags !== undefined) updateData.tags = tags;
    if (sentiment !== undefined) {
      if (sentiment !== "positive" && sentiment !== "corrective") {
        return res.status(400).json({ error: "sentiment must be 'positive' or 'corrective'" });
      }
      updateData.sentiment = sentiment;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const updated = await storage.updateFeedback(id, updateData as Partial<DesignFeedback>);

    // Re-embed only if text changed
    if (feedbackText && feedbackText !== existing.feedbackText) {
      try {
        const embedding = await generateTextEmbedding(feedbackText);
        await updateFeedbackVector(id, embedding);
      } catch (embedError) {
        console.error("[feedback] Re-embedding failed for feedback", id, embedError);
        Sentry.captureException(embedError);
      }
    }

    res.json(updated);
  } catch (error: unknown) {
    Sentry.captureException(error);
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});
```

### Complete DELETE Endpoint

```typescript
// Source: derived from routes.ts DELETE /api/reference-images/:id pattern (line 508)
app.delete("/api/feedback/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await storage.getFeedback(id);
    if (!existing) {
      return res.status(404).json({ error: "Feedback not found" });
    }

    await storage.deleteFeedback(id);
    res.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});
```

### GET Single Feedback (for Phase 6 detail view + 404 check after delete)

```typescript
app.get("/api/feedback/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const feedback = await storage.getFeedback(id);
    if (!feedback) {
      return res.status(404).json({ error: "Feedback not found" });
    }
    res.json(feedback);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});
```

## State of the Art

No changes in approach since project inception. Express + Drizzle + pgvector is the standard pattern throughout the codebase. [VERIFIED: codebase]

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | Express + Drizzle CRUD + Zod validation | Existing pattern | No change needed |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Text embedding is fast (~200ms) and rarely fails | Pitfall 1 | If embedding frequently fails, need async pattern or retry. Low risk -- Gemini text embedding is the simplest API call. |
| A2 | Pagination default of 20 items per page is appropriate | Code Examples | If feedback corpus grows very large, may need adjusted default. Low risk -- can be changed via query param. |

## Open Questions

1. **Embedding failure strategy on POST**
   - What we know: Text embedding can fail (Gemini transient errors). The row is created before embedding.
   - What's unclear: Should POST return 201 (row saved, embedding failed silently) or 500 (full failure, no row)?
   - Recommendation: Return 201 with the row. Log the embedding error. The row is useful even without embedding. Phase 5/6 can show "pending embedding" status. This matches the reference_images pattern where the row exists before embedding.

2. **GET /api/feedback/:id endpoint**
   - What we know: Success criterion 5 says "a subsequent GET returns 404 for that id" after delete.
   - What's unclear: Is a separate GET-by-ID endpoint explicitly required, or is this tested against the list endpoint?
   - Recommendation: Add `GET /api/feedback/:id` as a bonus endpoint. It costs ~5 lines, Phase 6 will need it for detail views, and it satisfies the success criterion cleanly.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.2 |
| Config file | `playwright.config.ts` |
| Quick run command | `npx playwright test tests/feedback-api.spec.ts --project=chromium` |
| Full suite command | `npx playwright test --project=chromium` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | POST /api/feedback returns 201 with id + embedding stored | API integration | `npx playwright test tests/feedback-api.spec.ts -g "POST creates" --project=chromium` | No -- Wave 0 |
| API-02 | GET /api/feedback returns paginated list ordered by createdAt desc | API integration | `npx playwright test tests/feedback-api.spec.ts -g "GET paginated" --project=chromium` | No -- Wave 0 |
| API-03 | GET with category+theme filters returns only matching entries | API integration | `npx playwright test tests/feedback-api.spec.ts -g "GET filtered" --project=chromium` | No -- Wave 0 |
| API-04 | PUT with changed text triggers re-embedding | API integration | `npx playwright test tests/feedback-api.spec.ts -g "PUT re-embeds" --project=chromium` | No -- Wave 0 |
| API-05 | DELETE removes row, subsequent GET returns 404 | API integration | `npx playwright test tests/feedback-api.spec.ts -g "DELETE removes" --project=chromium` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npx playwright test tests/feedback-api.spec.ts --project=chromium`
- **Per wave merge:** `npx playwright test --project=chromium`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/feedback-api.spec.ts` -- covers API-01 through API-05 (5 Playwright API tests using `request` context)
- [ ] No new framework install needed -- Playwright already configured

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth in this codebase (noted in ARCHITECTURE.md) |
| V3 Session Management | No | No sessions for API endpoints |
| V4 Access Control | No | Open API, no auth middleware |
| V5 Input Validation | Yes | Zod `insertDesignFeedbackSchema.safeParse()` on POST; sentiment enum validation on PUT |
| V6 Cryptography | No | No crypto operations |

### Known Threat Patterns for Express + User Text Input

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via feedback text stored/returned | Tampering | Text is stored raw, rendered by React (auto-escapes). No server-side HTML rendering. [VERIFIED: React auto-escapes JSX] |
| Prompt injection via feedback text | Tampering | Phase 4 (ENRICH-04) handles sanitization before prompt injection. Not in scope for Phase 3. |
| SQL injection via query params | Tampering | Drizzle ORM parameterizes all queries. Raw SQL in feedback-vector-store.ts uses drizzle `sql` tagged templates (auto-parameterized). [VERIFIED: feedback-vector-store.ts] |
| DoS via large feedback text | Denial of Service | Zod schema validates text type. Consider adding `.max(5000)` to feedbackText in validation. [ASSUMED: no existing length limit] |
| Pagination abuse (limit=999999) | Denial of Service | Clamp limit to `Math.min(100, ...)` in GET handler. [VERIFIED: code example above] |

## Sources

### Primary (HIGH confidence)
- `server/routes.ts` -- all 30+ existing endpoint patterns, error handling, Sentry integration
- `server/storage.ts` -- all existing DatabaseStorage methods, IStorage interface pattern
- `server/feedback-vector-store.ts` -- Phase 2 artifact with add, search, delete, update functions
- `shared/schema.ts` -- designFeedback table definition, insertDesignFeedbackSchema, DesignFeedback type
- `server/google-client.ts` -- generateTextEmbedding function (line 118)
- `client/src/lib/api.ts` -- all existing fetch wrapper patterns
- `.planning/phases/01-schema-database-foundation/01-01-SUMMARY.md` -- Phase 1 decisions (updatedAt, sentiment enum)
- `.planning/phases/02-feedback-vector-store-module/02-01-SUMMARY.md` -- Phase 2 exports and patterns
- `.planning/STATE.md` -- accumulated decisions and blockers

### Secondary (MEDIUM confidence)
- Drizzle ORM documentation for `and()`, `count()`, `.offset()`, `.limit()` query builder methods [ASSUMED: standard drizzle-orm API]

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, zero new dependencies
- Architecture: HIGH -- follows exact existing patterns from 30+ endpoints
- Pitfalls: HIGH -- identified from direct codebase analysis and Phase 1/2 decisions

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- no moving parts, all internal code)
