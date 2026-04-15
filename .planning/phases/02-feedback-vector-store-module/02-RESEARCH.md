# Phase 2: Feedback Vector Store Module - Research

**Researched:** 2026-04-15
**Domain:** pgvector raw SQL module for feedback embeddings
**Confidence:** HIGH

## Summary

Phase 2 creates a single new file (`server/feedback-vector-store.ts`) that provides four exported functions for storing, searching, deleting, and updating feedback embedding vectors in the `design_feedback` table. The critical constraint is that this module must use raw SQL via the existing `db` object from `server/db.ts` and must NEVER import or call any function from `server/vector-store.ts`, because that module is hardcoded to the `reference_images` table.

The existing `server/vector-store.ts` provides the exact pattern to mirror: it uses `db.execute(sql\`...\`)` for pgvector operations with the `<=>` cosine distance operator. The new module differs in three ways: (1) it targets `design_feedback` instead of `reference_images`, (2) it adds mandatory `category` AND `theme` WHERE filters before similarity ranking, and (3) it applies a 0.75 similarity threshold gate that excludes low-relevance results. All functions must be wrapped in try/catch with error isolation — search errors return empty arrays, never crash callers.

The `design_feedback` table was defined in Phase 1 (shared/schema.ts) with an `embedding_vector` column of type `vector(3072)`, `category` (text, NOT NULL), and `theme` (text, NOT NULL). These columns are the filter keys for search.

**Primary recommendation:** Mirror `server/vector-store.ts` function signatures and raw SQL patterns exactly, but target `design_feedback` table with category+theme filters and a 0.75 cosine similarity floor.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STORE-01 | Dedicated feedback-vector-store module with add, search, delete, update operations | New file `server/feedback-vector-store.ts` with 4 exported functions; raw SQL via `db.execute(sql\`...\`)` pattern from existing vector-store.ts |
| STORE-02 | Search filters by category AND theme before ranking by cosine similarity | WHERE clause with `category = $X AND theme = $Y` applied before `ORDER BY embedding_vector <=> query::vector`; verified by success criteria #2 |
| STORE-03 | Similarity threshold gate (0.75 minimum) prevents irrelevant feedback from being retrieved | Post-query filter: `HAVING (1 - (embedding_vector <=> query::vector)) >= 0.75` or application-layer `.filter()`; 0.75 is a locked decision from STATE.md |
| STORE-04 | Error in feedback retrieval never blocks image generation (try/catch isolation) | Every exported function wrapped in try/catch; `searchSimilarFeedback` returns `[]` on error; `console.error` for logging |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **No `any` types** -- define proper TypeScript interfaces
- **Do not modify:** `server/db.ts`, `server/vector-store.ts`, `server/vite.ts`, `vite.config.ts`, `tsconfig.json`, `drizzle.config.ts`
- **Run `npm run check` after every TypeScript change**
- **No new dependencies** -- use existing libraries only
- **Reuse `db` from `server/db.ts`** -- do not create a new pg Pool
- **Raw SQL via `db.execute(sql\`...\`)` from drizzle-orm** -- this is the pattern used by vector-store.ts

---

## Standard Stack

### Core (all existing -- no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.39.3 | `sql` tagged template for raw SQL queries | Already used in `vector-store.ts` for all pgvector operations [VERIFIED: server/vector-store.ts direct inspection] |
| `pg` | 8.16.3 | PostgreSQL driver (used by Drizzle pool) | Existing connection pool in `server/db.ts` [VERIFIED: server/db.ts direct inspection] |
| pgvector extension | -- | `vector(3072)` type + `<=>` cosine distance operator | Already installed and used for `reference_images` and `stock_items` tables [VERIFIED: shared/schema.ts] |

**No installation needed.** [VERIFIED: all packages already in production use]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw SQL via `db.execute()` | Drizzle ORM query builder | Drizzle has no native pgvector operator support; `<=>` must be raw SQL regardless. Using `db.execute(sql\`...\`)` is the established pattern. |
| Application-layer threshold filter | SQL `HAVING` clause | SQL-side filtering is marginally more efficient but harder to debug. Application-layer `.filter()` after query is simpler and matches existing pattern. Recommend application-layer. |

---

## Architecture Patterns

### New File Location
```
server/
├── vector-store.ts              # Existing — reference_images vectors (DO NOT MODIFY)
├── feedback-vector-store.ts     # NEW — design_feedback vectors (this phase)
├── db.ts                        # Existing — shared pg Pool + Drizzle instance
└── ...
```

### Pattern: Mirror vector-store.ts with Feedback-Specific Filters

The existing `vector-store.ts` establishes a clear pattern:

1. Import `db` from `./db` and `sql` from `drizzle-orm`
2. Define a result interface (e.g., `SimilarVector`)
3. Build vector string as `[${embedding.join(",")}]`
4. Use `db.execute(sql\`...\`)` for all queries
5. Compute similarity as `1 - (embedding_vector <=> ${vectorStr}::vector)`
6. Return mapped results with `parseFloat(row.similarity)`

The feedback module adds:
- Mandatory `category` + `theme` WHERE filters (STORE-02)
- A 0.75 similarity floor applied after query (STORE-03)
- try/catch on every function with graceful degradation (STORE-04)

### Function Signatures (STORE-01)

```typescript
// Result interface
interface SimilarFeedback {
  id: string;
  feedbackText: string;
  sentiment: string;
  tags: string[];
  similarity: number;
}

// Four exported functions
addFeedbackVector(id: string, embedding: number[], category: string, theme: string): Promise<void>
searchSimilarFeedback(queryEmbedding: number[], category: string, theme: string, topK?: number): Promise<SimilarFeedback[]>
deleteFeedbackVector(id: string): Promise<void>
updateFeedbackVector(id: string, embedding: number[]): Promise<void>
```

**Why `addFeedbackVector` takes category and theme:** The insert function must store the embedding on a row that already has category/theme from the initial feedback creation (Phase 3 API). However, the success criteria say `addFeedbackVector(id, embedding, category, theme)` stores a vector row and it is queryable. This means the function does an UPDATE (setting embedding_vector on existing row) or an INSERT. Since Phase 3's API endpoint creates the row first (with feedbackText, category, theme, etc.) and then embeds, `addFeedbackVector` should UPDATE the embedding_vector on the existing row identified by `id`. The category and theme parameters serve as verification/logging but the UPDATE targets by `id`. [VERIFIED: this matches vector-store.ts `addVector()` which does `db.update(referenceImages).set({embeddingVector}).where(eq(id))`]

**Alternative interpretation:** The success criteria literally say "stores a vector row" -- this could mean the function should do a full INSERT. But since Phase 3 creates the DB row first (with all metadata) and then calls the embed function, UPDATE is correct. The category/theme params in the signature ensure the caller confirms the context. [ASSUMED -- depends on Phase 3 API flow]

### Anti-Patterns to Avoid

- **Importing from vector-store.ts:** NEVER call `addVector()`, `searchSimilarVectors()`, or any function from `server/vector-store.ts`. They are hardcoded to `reference_images`. This is a LOCKED BLOCKER from STATE.md.
- **Creating a new pg Pool:** Reuse `db` from `server/db.ts`. Creating a second pool wastes connections.
- **Using Drizzle ORM query builder for vector ops:** The `<=>` operator is not a Drizzle built-in. Raw SQL via `sql` tagged template is required.
- **Forgetting to parameterize:** Always use `${variable}` inside the `sql` tagged template for SQL injection safety. Never string-concatenate user input.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector string formatting | Custom serializer | `[${embedding.join(",")}]` + `::vector` cast | Exact pattern from vector-store.ts; pgvector expects this format [VERIFIED: vector-store.ts line 13] |
| Cosine similarity | Manual dot-product calculation | `1 - (embedding_vector <=> query::vector)` | pgvector handles this in SQL; `<=>` is cosine distance, `1 - distance = similarity` [VERIFIED: vector-store.ts line 39] |
| Connection pooling | New Pool instance | `import { db } from "./db"` | Pool already configured with DATABASE_URL [VERIFIED: server/db.ts] |
| UUID generation | `crypto.randomUUID()` | DB-side `gen_random_uuid()` | Row already created by Phase 3 API with DB-generated UUID |

**Key insight:** Every pgvector operation pattern is already solved in `vector-store.ts`. The only novelty is the WHERE filters and threshold gate.

---

## Common Pitfalls

### Pitfall 1: Calling vector-store.ts Functions
**What goes wrong:** `addVector()` and `searchSimilarVectors()` update/query `reference_images`, not `design_feedback`. Feedback vectors silently end up in the wrong table, or searches return reference image metadata instead of feedback.
**Why it happens:** Developer sees existing abstractions and tries to reuse them.
**How to avoid:** `feedback-vector-store.ts` must have ZERO imports from `vector-store.ts`. Grep check: `grep -n "vector-store" server/feedback-vector-store.ts` should return nothing.
**Warning signs:** TypeScript compiles fine but search returns `metadata` field (from reference_images) instead of `feedbackText`.

### Pitfall 2: Missing Category+Theme Filter on Search
**What goes wrong:** Search returns high-similarity feedback from a completely different jewellery category (e.g., Ring feedback injected into Necklace generation).
**Why it happens:** Developer forgets the WHERE clause or makes filters optional.
**How to avoid:** `category` and `theme` are mandatory (non-optional) parameters. The SQL WHERE clause MUST include `AND category = ${category} AND theme = ${theme}` before the ORDER BY.
**Warning signs:** Success criteria #2 fails -- "rows from a different category are excluded" is not met.

### Pitfall 3: Threshold Applied Wrong Direction
**What goes wrong:** The 0.75 gate filters OUT good results (keeping only low-similarity ones) because the comparison is inverted.
**Why it happens:** Confusion between cosine distance (lower = more similar) and cosine similarity (higher = more similar). pgvector `<=>` returns distance.
**How to avoid:** Compute `similarity = 1 - distance`. Filter `similarity >= 0.75` (keep high values). Verify: inserting a random vector and searching should return empty results.
**Warning signs:** Search returns garbage results but excludes relevant ones.

### Pitfall 4: Error in Search Crashes Caller
**What goes wrong:** A database connection error in `searchSimilarFeedback` propagates up and causes a 500 error on the generation endpoint, blocking image generation entirely.
**Why it happens:** Missing try/catch or re-throwing the error.
**How to avoid:** Wrap the entire function body in try/catch. On error: `console.error("[feedback-vector-store] Search error:", error)` and `return []`. The empty array signals "no feedback found" which is safe -- generation proceeds without feedback enrichment.
**Warning signs:** Generation endpoint returns 500 when the database has a transient error, even though feedback is optional.

### Pitfall 5: Using `any` for Row Types
**What goes wrong:** TypeScript compiles but runtime errors from accessing wrong property names on query results.
**Why it happens:** `db.execute()` returns untyped rows. Developer casts to `any[]` and accesses properties without checking.
**How to avoid:** Define a `FeedbackVectorRow` interface matching the SQL SELECT column aliases. Cast `results.rows as FeedbackVectorRow[]`. Use snake_case property names matching PostgreSQL column names (not camelCase).
**Warning signs:** `row.feedbackText` returns `undefined` because the actual column is `row.feedback_text`.

### Pitfall 6: SQL Column Names Are snake_case
**What goes wrong:** Query uses `feedbackText` (camelCase) in SQL, causing "column does not exist" errors.
**Why it happens:** Drizzle ORM maps camelCase to snake_case automatically, but raw `sql` tagged templates use literal SQL -- no auto-mapping.
**How to avoid:** In raw SQL: use `feedback_text`, `embedding_vector`, `design_project_id` (snake_case). In TypeScript interfaces for row results: use `feedback_text`, `similarity`, etc.
**Warning signs:** PostgreSQL error: `column "feedbackText" does not exist`.

---

## Code Examples

### Complete Module Structure
```typescript
// server/feedback-vector-store.ts
// Source: mirrors server/vector-store.ts pattern, targets design_feedback table
// CRITICAL: Do NOT import from ./vector-store — those functions target reference_images

import { db } from "./db";
import { sql } from "drizzle-orm";

/** Result shape for similarity search */
interface SimilarFeedback {
  id: string;
  feedbackText: string;
  sentiment: string;
  tags: string[];
  similarity: number;
}

/** Row shape from raw SQL (snake_case column names) */
interface FeedbackVectorRow {
  id: string;
  feedback_text: string;
  sentiment: string;
  tags: string[];
  similarity: string; // parseFloat needed — pg returns numeric as string
}

const SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_TOP_K = 5;
```

### addFeedbackVector (STORE-01)
```typescript
// Source: mirrors vector-store.ts addVector() pattern
export async function addFeedbackVector(
  id: string,
  embedding: number[],
  category: string,
  theme: string
): Promise<void> {
  try {
    const vectorStr = `[${embedding.join(",")}]`;
    await db.execute(sql`
      UPDATE design_feedback
      SET embedding_vector = ${vectorStr}::vector
      WHERE id = ${id}
    `);
  } catch (error) {
    console.error("[feedback-vector-store] addFeedbackVector error:", error);
    throw error; // add SHOULD throw — caller needs to know embedding failed
  }
}
```

### searchSimilarFeedback (STORE-02, STORE-03, STORE-04)
```typescript
// Source: mirrors vector-store.ts searchSimilarVectors() with category+theme filter + threshold
export async function searchSimilarFeedback(
  queryEmbedding: number[],
  category: string,
  theme: string,
  topK: number = DEFAULT_TOP_K
): Promise<SimilarFeedback[]> {
  try {
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const results = await db.execute(sql`
      SELECT
        id,
        feedback_text,
        sentiment,
        tags,
        1 - (embedding_vector <=> ${vectorStr}::vector) as similarity
      FROM design_feedback
      WHERE embedding_vector IS NOT NULL
        AND category = ${category}
        AND theme = ${theme}
      ORDER BY embedding_vector <=> ${vectorStr}::vector
      LIMIT ${topK}
    `);

    // STORE-03: Apply 0.75 similarity threshold gate
    return (results.rows as FeedbackVectorRow[])
      .map(row => ({
        id: row.id,
        feedbackText: row.feedback_text,
        sentiment: row.sentiment,
        tags: row.tags,
        similarity: parseFloat(row.similarity) || 0,
      }))
      .filter(r => r.similarity >= SIMILARITY_THRESHOLD);
  } catch (error) {
    // STORE-04: Error isolation — return empty, never crash caller
    console.error("[feedback-vector-store] searchSimilarFeedback error:", error);
    return [];
  }
}
```

### deleteFeedbackVector (STORE-01)
```typescript
// Source: differs from vector-store.ts deleteVector() which nullifies —
// feedback deletion should remove the entire row (Phase 3 API DELETE removes the row)
// But for vector-store module scope: just null the embedding
export async function deleteFeedbackVector(id: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM design_feedback
      WHERE id = ${id}
    `);
  } catch (error) {
    console.error("[feedback-vector-store] deleteFeedbackVector error:", error);
    throw error; // delete SHOULD throw — caller needs to know
  }
}
```

### updateFeedbackVector (STORE-01)
```typescript
// Re-embed after feedback text is edited (Phase 3 PUT endpoint)
export async function updateFeedbackVector(
  id: string,
  embedding: number[]
): Promise<void> {
  try {
    const vectorStr = `[${embedding.join(",")}]`;
    await db.execute(sql`
      UPDATE design_feedback
      SET embedding_vector = ${vectorStr}::vector
      WHERE id = ${id}
    `);
  } catch (error) {
    console.error("[feedback-vector-store] updateFeedbackVector error:", error);
    throw error;
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSONB embedding column | pgvector `vector(3072)` | Already migrated (reference_images) | Use `embedding_vector` column, never JSONB |
| Drizzle ORM for vector queries | Raw SQL via `db.execute(sql\`...\`)` | Current pattern in codebase | No Drizzle abstraction for `<=>` operator |

**Deprecated/outdated:**
- `embedding` JSONB column on `reference_images`: legacy, kept for backward compat. The `design_feedback` table has NO JSONB embedding column -- only `embedding_vector` (pgvector). [VERIFIED: shared/schema.ts designFeedback table definition]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `addFeedbackVector` does an UPDATE (not INSERT) because Phase 3 API creates the row first | Function Signatures | If Phase 3 expects addFeedbackVector to INSERT the full row, the function signature needs all feedback fields -- but this contradicts separation of concerns. LOW risk. |
| A2 | `deleteFeedbackVector` should DELETE the entire row (not just null the vector) | Code Examples | If Phase 3 API handles row deletion separately and only expects vector nullification, change to UPDATE SET embedding_vector = NULL. LOW risk -- success criteria says "removes the row and subsequent search returns nothing", implying full DELETE. |
| A3 | Application-layer threshold filter (`.filter()`) is preferred over SQL HAVING clause | Architecture Patterns | Both work. SQL-side is marginally more efficient but harder to unit test. Functionally equivalent at the expected scale (<1000 feedback entries). |
| A4 | `topK` default of 5 is appropriate | Code Examples | STATE.md says "Hard cap of 5 injected feedback entries per generation". If topK should be different, it is trivially changeable. |

---

## Open Questions

1. **Should `deleteFeedbackVector` DELETE the row or just NULL the embedding?**
   - What we know: Success criteria #5 says "removes the row and a subsequent search for that vector returns nothing". This suggests full row DELETE.
   - What's unclear: Phase 3 API DELETE endpoint may want to handle row deletion itself and only call this to clean up the vector.
   - Recommendation: Implement as full DELETE to match success criteria. Phase 3 can call this directly for its DELETE endpoint. If Phase 3 needs finer control, the function can be split later.

2. **Should `addFeedbackVector` verify the row exists before UPDATE?**
   - What we know: If the row does not exist, the UPDATE silently affects 0 rows.
   - What's unclear: Whether this is acceptable or should throw.
   - Recommendation: Do not add existence check -- keep it simple. The caller (Phase 3 API) is responsible for creating the row first. A failed UPDATE (0 rows affected) is harmless.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.2 (existing dev dependency, but no unit test config) |
| Config file | `tests/` directory exists with Playwright specs |
| Quick run command | `npm run check` |
| Full suite command | `npm run check` (no unit test runner configured) |

### Phase Requirements --> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STORE-01 | Module exports add, search, delete, update functions | compile | `npm run check` | No -- Wave 0 |
| STORE-02 | Search filters by category AND theme | manual (insert test data + query) | psql or test script | No -- Wave 0 |
| STORE-03 | 0.75 threshold gate excludes low-similarity results | manual (insert dissimilar vector + verify empty result) | psql or test script | No -- Wave 0 |
| STORE-04 | Error in search returns empty array, no crash | manual (simulate DB error) | test script | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run check`
- **Per wave merge:** `npm run check` + manual verification of success criteria via test script
- **Phase gate:** All 5 success criteria verified before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] No unit test runner for isolated function testing -- rely on TypeScript compile check + manual SQL verification
- [ ] Consider a simple test script (`scripts/test-feedback-vectors.ts`) that exercises all 4 functions against the real DB

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- no auth in this project |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A -- no auth |
| V5 Input Validation | Yes | Drizzle `sql` tagged template parameterizes all inputs; no string concatenation [VERIFIED: pattern in vector-store.ts] |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via embedding array | Tampering | `sql` tagged template auto-parameterizes; vector string built from `number[]` (no user strings in vector) [VERIFIED: drizzle-orm sql tag] |
| SQL injection via category/theme | Tampering | Passed as `${category}` in `sql` tag -- parameterized, not concatenated [VERIFIED: vector-store.ts pattern] |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL + pgvector | Vector operations | Yes (production) | -- | None -- blocking |
| `drizzle-orm` sql tag | Raw SQL queries | Yes | 0.39.3 | None |
| `design_feedback` table | All functions | Depends on Phase 1 | -- | Phase 1 must complete first |

**Missing dependencies with no fallback:**
- Phase 1 must be complete (table must exist in DB via `npm run db:push`)

---

## Sources

### Primary (HIGH confidence)
- `server/vector-store.ts` (direct inspection) -- all pgvector patterns, function signatures, SQL syntax, vector string formatting
- `shared/schema.ts` (direct inspection) -- `designFeedback` table definition with `embedding_vector`, `category`, `theme` columns
- `server/db.ts` (direct inspection) -- `db` export, Drizzle + pg Pool setup
- `.planning/REQUIREMENTS.md` (direct inspection) -- STORE-01 through STORE-04 requirements
- `.planning/STATE.md` (direct inspection) -- 0.75 threshold decision, 5-entry cap, pitfall about wrong vector table
- `.planning/ROADMAP.md` (direct inspection) -- Phase 2 success criteria (5 items)
- Phase 1 research (`01-RESEARCH.md`) -- confirms schema patterns, Drizzle conventions

### Secondary (MEDIUM confidence)
- None needed -- all patterns are in the codebase

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via direct file inspection, already in production
- Architecture: HIGH -- directly mirrors existing vector-store.ts, minimal novelty
- Pitfalls: HIGH -- derived from codebase inspection + STATE.md explicit warnings
- Function signatures: HIGH -- derived from success criteria + existing patterns

**Research date:** 2026-04-15
**Valid until:** Stable -- no external dependencies to go stale; pure server-side SQL module
