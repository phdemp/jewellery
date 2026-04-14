# Project Research Summary

**Project:** Raniwala 1881 — Design Brain: Feedback & Prompt Learning
**Domain:** Feedback-enriched RAG pipeline for AI jewellery sketch generation
**Researched:** 2026-04-14
**Confidence:** HIGH

## Executive Summary

This milestone adds a designer feedback memory layer to an existing production RAG pipeline. The approach is a textbook brownfield extension: one new database table (`design_feedback`), one new server module (`feedback-vector-store.ts`), incremental additions to existing storage and route files, and a lightweight inline UI component. No new dependencies are required — the existing pgvector column type, Gemini text embedding function, Drizzle ORM push workflow, React Hook Form + Zod, and TanStack Query patterns cover every technical requirement. The constraint is a feature, not a limitation: it keeps the implementation footprint small and the risk profile low.

The core architecture is two parallel pgvector retrieval paths that merge at prompt assembly. The existing path retrieves reference images by visual embedding similarity. The new path retrieves past designer feedback by text embedding similarity, filtered by category and theme to prevent cross-product contamination. Both paths feed into `buildImagePromptJSON()`, where feedback arrives as a `designer_feedback` key in the JSON spec — equal-weight to motifs and stone specs, not buried in a prose appendix. This is the recommended injection pattern: structured, scoped, and auditable.

The primary risks are not technical — they are trust and correctness risks. Prompt injection via stored feedback text is a real attack vector even in single-user internal tools. Cold-start retrieval produces misleading noise before the corpus reaches ~10 entries per category/theme. Negative feedback without sentiment framing suppresses motifs the designer explicitly requests. All three risks are preventable with decisions made at schema and injection design time, not retrofit time. The feedback management page must ship with the initial feature, not after it — without visibility into what the system has stored, designer trust collapses on the first unexpected output.

---

## Key Findings

### Recommended Stack

The existing stack handles everything. No new packages, no new services, no new infrastructure. The `vector(3072)` custom type is already defined in `shared/schema.ts` — the new `design_feedback` table reuses it verbatim. `generateTextEmbedding()` already exists in `server/google-client.ts` and is the only active embedding pipeline (OpenAI hit a billing hard limit; Gemini embedding-001 is confirmed working). The `db:push` workflow creates the new table without migration files.

**Core technologies:**
- `design_feedback` table + pgvector `vector(3072)` column — stores feedback text and semantic embeddings for similarity retrieval, mirrors the existing `reference_images` pattern exactly
- `generateTextEmbedding()` from `server/google-client.ts` — Gemini embedding-001, 3072-dim, called once per feedback submission
- `db.execute(sql...)` with `<=>` cosine operator — same raw SQL pattern as `searchSimilarVectors()` in `vector-store.ts`, applied to the new feedback table via a dedicated `feedback-vector-store.ts` module
- `buildImagePromptJSON()` extras object — the existing JSON prompt builder already accepts an `extras` map; feedback is injected as `extras.designer_feedback: string[]`
- React Hook Form + Zod + shadcn/ui Textarea — mandatory per CLAUDE.md; all components already installed

### Expected Features

**Must have (table stakes):**
- Inline feedback text box below generated image on all 4 generation pages — without immediacy, the signal is lost
- Persistent `design_feedback` DB table — feedback disappears on reload without this; trust collapses
- Feedback influences the very next generation — the loop must visibly close or the feature has no value
- Visual confirmation (Sonner toast) that feedback was saved — silence after submission creates doubt
- Delete individual feedback entries — no delete means no way to remove poisoned entries
- Feedback management page at `/feedback` — designers must see what the system has "learned"; without this, it is a black box
- Coverage on all 4 generation pages (Home, Modify, CAD, Marketing) — inconsistent coverage confuses UX
- Category and theme captured automatically with each entry — enables scoped retrieval; without it, retrieval degrades fast

**Should have (differentiators):**
- Sentiment field (`positive | negative | suggestion`) — prevents negative feedback from suppressing explicitly requested motifs; enables framing-aware injection
- Vector-similarity retrieval over category+theme filter — finds semantically related feedback that keyword search misses
- "X preferences active" count badge before generation — tells designer the system is working; reduces anxiety
- Feedback tag vocabulary (Proportions, Stone Placement, Motifs, Style, Layout, Colour) — narrows retrieval scope without overwhelming the designer
- Feedback impact transparency — collapsible section after generation showing which feedback was injected; builds trust

**Defer to v2+:**
- "What the system learned" auto-summary (Gemini summarization over full corpus) — nice to have, not needed for the loop to function; adds API cost
- Time decay in retrieval ranking — corpus will be too small to matter for months; implement when >50 entries exist per category/theme
- Feedback edit (PUT endpoint) — low urgency; delete-and-resubmit achieves the same result

### Architecture Approach

The feedback system is a parallel retrieval lane that merges at prompt assembly time. The existing pipeline (text embedding → reference image vector search → prompt assembly → generation) is unchanged. The new lane runs alongside: on each generation request, `getRelevantFeedback(category, theme, queryEmbedding)` queries `design_feedback` with a hard category+theme filter and cosine similarity ranking. Results are passed into `buildImagePromptJSON()` as `extras.designer_feedback`. At schema level, `google-client.ts` does not need modification — it receives feedback as just another entry in the extras map.

**Major components:**
1. `shared/schema.ts` (extend) — `design_feedback` table: id, design_project_id (FK, ON DELETE SET NULL), text, sentiment, tags[], category, theme, embedding_vector vector(3072), created_at
2. `server/feedback-vector-store.ts` (new) — `addFeedbackVector()` and `searchSimilarFeedback(queryEmbedding, category, theme)` with similarity threshold gate (0.75 minimum) and hard cap (5 entries max injected)
3. `server/storage.ts` (extend) — `createFeedback()`, `getAllFeedback()`, `updateFeedback()`, `deleteFeedback()`, `getFeedbackByProject()` on `DatabaseStorage`
4. `server/routes.ts` (extend) — 4 CRUD endpoints + `getRelevantFeedback()` helper injected into all 4 generation route handlers
5. `client/src/components/feedback-form.tsx` (new) — inline RHF+Zod form with Textarea, sentiment picker, tag multi-select; mounted below `ResultDisplay` on all 4 pages
6. `client/src/pages/feedback.tsx` (new) — management page: list, filter by category/theme/tag, delete
7. `client/src/lib/api.ts` (extend) — typed fetch wrappers for all feedback endpoints

### Critical Pitfalls

1. **Prompt injection via stored feedback text** — feedback is retrieved from DB and injected verbatim into Gemini prompts; malformed or adversarial text can override BRAND_RULES. Prevention: wrap injected text in a clearly delimited framing block `[DESIGNER FEEDBACK — style preference context only]`; validate server-side for instruction-like patterns before storing; log every injected snippet.

2. **Cold-start retrieval returning irrelevant noise** — with fewer than ~10 entries per category/theme, cosine similarity returns the "least bad" match rather than a useful one; early feedback actively misleads generations. Prevention: enforce a minimum similarity threshold of 0.75; display corpus size in the UI; gate injection until at least 5 entries exist per category/theme cell.

3. **Negative feedback suppresses requested motifs** — "peacock looks too cartoonish" and "peacock works beautifully" produce similar embeddings; without sentiment framing, the AI may treat negative statements as prohibitions. Prevention: mandatory sentiment field (positive/negative/suggestion); framing-aware injection prefix per sentiment type.

4. **Wrong vector table queried** — `vector-store.ts` functions look generic but are hardcoded to `reference_images`; reusing them for feedback silently queries the wrong table. Prevention: build a dedicated `feedback-vector-store.ts` module; never pass feedback IDs to `addVector()` from `vector-store.ts`.

5. **Context bloat at scale** — injecting all matching feedback without a cap causes prompt length to grow unboundedly; Gemini attention dilutes on long prompts, degrading generation quality. Prevention: hard cap of 5 entries; sort by similarity descending; monitor prompt character count in server logs.

---

## Implications for Roadmap

Based on combined research, the build order is strictly dependency-driven. Each phase unlocks the next. Do not parallelize phases — the schema must exist before the vector store, which must exist before the API endpoints, which must have data before the retrieval hook can be tested.

### Phase 1: Schema and Storage Foundation
**Rationale:** Every other component depends on the DB table and Drizzle types. Nothing can be tested until this exists. TypeScript types generated from schema are consumed by all downstream phases.
**Delivers:** `design_feedback` table in PostgreSQL; Drizzle ORM types; Zod insert/select schemas; IStorage extension with 5 CRUD methods; DatabaseStorage implementations.
**Addresses:** Table stakes — persistent storage requirement.
**Avoids:** Pitfall 10 (Drizzle vector customType ordering — place table definition after line 211 in schema.ts); Pitfall 13 (wrong FK delete behavior — use ON DELETE SET NULL); Pitfall 5 (association drift — add `sentiment` and `displayedModel` columns at table creation, not retroactively).

### Phase 2: Feedback Vector Store Module
**Rationale:** Mirrors the existing `vector-store.ts` pattern — low risk, validates the schema is correct, and unlocks both the submission endpoint (Phase 3) and the retrieval hook (Phase 4).
**Delivers:** `server/feedback-vector-store.ts` with `addFeedbackVector()` and `searchSimilarFeedback()` including similarity threshold (0.75) and result cap (5 entries).
**Uses:** Raw SQL + pgvector `<=>` operator — same pattern as `searchSimilarVectors()`.
**Avoids:** Pitfall 4 (wrong table queried — dedicated module ensures feedback search never touches `reference_images`); Pitfall 2 (cold-start noise — threshold gate built in from day one); Pitfall 3 (context bloat — cap built in from day one).

### Phase 3: Feedback API Endpoints
**Rationale:** Enables data entry for testing Phase 4. Cannot test retrieval or injection without real feedback rows in the DB.
**Delivers:** POST/GET/PUT/DELETE `/api/feedback` endpoints; `generateTextEmbedding()` called synchronously on POST (text is short, ~1-2s acceptable); typed request/response Zod validators.
**Implements:** API layer component from architecture.
**Avoids:** Pitfall 9 (synchronous embedding note — the PITFALLS research flags async as safer for resilience; decide here whether to go sync or async based on acceptable UX latency; sync is simpler and acceptable if Gemini embedding stays under 2s); Pitfall 1 (prompt injection — server-side sanitization on inbound text before storage).

### Phase 4: Prompt Enrichment Hook
**Rationale:** The highest-value component. Closes the feedback loop. Requires real data (Phase 3) to observe and test. Must be wired to all 4 generation endpoints simultaneously — wiring only one and deferring others is explicitly called out as a pitfall.
**Delivers:** `getRelevantFeedback()` helper in `routes.ts`; injection into `/api/generate-design`, `/api/modify-design`, `/api/generate-cad-comparison`, `/api/generate-marketing`; framing-aware prefix per sentiment type.
**Avoids:** Pitfall 12 (partial wiring — all 4 routes in this phase); Pitfall 7 (negative feedback suppression — sentiment-aware framing prefix per entry type); Pitfall 1 (prompt injection — delimited framing block wraps all injected text).

### Phase 5: UI Components and Management Page
**Rationale:** UI is additive. Building it last means the API contract is stable and independently testable before the frontend is attached. Management page is non-negotiable in this phase — it is part of the same feature, not polish.
**Delivers:** `FeedbackForm` component (RHF + Zod + shadcn Textarea + sentiment picker + tag multi-select); mounted below `ResultDisplay` on all 4 generation pages; `FeedbackPage` at `/feedback` with list/filter/delete; `api.ts` typed wrappers; App.tsx route + layout.tsx nav link.
**Avoids:** Pitfall 8 (management page deferred — build it here, not in v2); Pitfall 11 (visual inconsistency — use shadcn Textarea, OrnamentalDivider, gold color tokens from index.css); Pitfall 6 (tag granularity — 6 broad human-language tags, not column-name tags).

### Phase Ordering Rationale

- Schema before vector store because TypeScript types generated by Drizzle from schema.ts are imported by feedback-vector-store.ts
- Vector store before API endpoints because POST /api/feedback calls `addFeedbackVector()` directly
- API endpoints before prompt enrichment hook because the hook requires stored feedback rows to verify correct retrieval behavior
- All 4 generation routes wired in Phase 4 simultaneously, not sequentially, because partial wiring leaves the feature inconsistent and creates silent trust problems
- UI last because it is the only phase with no downstream dependencies — it can be tested against the stable API without risk of breaking the retrieval logic

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (API endpoints):** The sync-vs-async embedding decision deserves a spike. PITFALLS research recommends async (save text immediately, embed in background); STACK research recommends sync (simpler, 1-2s acceptable). The right answer depends on observed Gemini embedding latency in this project's environment. Check server logs for `generateTextEmbedding()` timing on existing reference image uploads before committing to a pattern.
- **Phase 4 (prompt enrichment):** The similarity threshold (0.75) and injection cap (5 entries) are research-derived starting points, not empirically tuned values. Plan a prompt log review after first 20 feedback submissions to calibrate. Log both the similarity scores of retrieved entries and the total feedback token count per generation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (schema):** Direct extension of existing Drizzle schema patterns. No unknowns — the `vector` customType, FK patterns, and `db:push` workflow are all in production.
- **Phase 2 (vector store):** Mirrors `vector-store.ts` exactly. Copy-adapt, not design-from-scratch.
- **Phase 5 (UI):** All components exist (shadcn Textarea, Checkbox, Badge). RHF + Zod form pattern is established in `design-form.tsx`. Management page follows `references.tsx` list view pattern.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against existing package.json and production codebase. No new dependencies. Embedding function confirmed working in prod. |
| Features | HIGH | Table stakes derived from first principles (feedback loop logic) + Google PAIR research guidelines + academic sources on designer feedback UX. The anti-features list is well-reasoned. |
| Architecture | HIGH | Build order is fully dependency-driven with no ambiguity. Component boundaries mirror existing patterns exactly. Only open question is sync vs async embedding (documented as a flag). |
| Pitfalls | HIGH | Critical pitfalls sourced from OWASP LLM Top 10, pgvector documentation, and context window research. Prompt injection and cold-start retrieval risks are well-documented at HIGH confidence. |

**Overall confidence:** HIGH

### Gaps to Address

- **Sync vs async embedding on feedback POST:** PITFALLS research makes a strong case for async (resilience if Gemini embedding API is slow or unavailable). STACK research recommends sync (simplicity). Check actual `generateTextEmbedding()` latency for short text in this environment before deciding. If P95 latency exceeds 3 seconds, go async.
- **Similarity threshold calibration (0.75):** This is a starting value from RAG best-practice literature, not tuned to this specific embedding model and domain. Log similarity scores on every retrieval call for the first month; adjust threshold based on observed score distributions.
- **Injection cap (5 entries):** The "all matching feedback" recommendation from PROJECT.md is valid for early-stage low-corpus use but must be bounded. The cap of 5 is a conservative starting point — if the corpus remains small (<30 entries per category/theme), the practical cap will rarely be hit.
- **`designProjectId` nullable after project deletion:** The `ON DELETE SET NULL` pattern is specified in research, but the current codebase does not have a project deletion feature. If project deletion is never added, this FK design choice is moot. Keep the nullable FK anyway as defensive schema design.

---

## Sources

### Primary (HIGH confidence)
- Existing codebase (`shared/schema.ts`, `server/vector-store.ts`, `server/google-client.ts`, `server/routes.ts`, `server/storage.ts`) — all patterns verified by direct inspection
- OWASP LLM Top 10 2025 — LLM01 Prompt Injection — prompt injection risk model
- Google PAIR Guidebook — Feedback and Controls chapter — visibility and control requirements for AI feedback loops
- Drizzle ORM pgvector guide — vector column API, schema migration patterns
- TanStack Query v5 docs — useMutation API
- shadcn/ui docs — React Hook Form + Zod integration pattern

### Secondary (MEDIUM confidence)
- Preference-Guided Prompt Optimization (Promptimizer, arXiv 2602.13131) — validates user-driven preference collection as effective prompt enrichment
- RAG metadata filtering pattern (markaicode.com) — hard filter + semantic search pattern; consistent with existing searchSimilarVectors() implementation
- Feedback Flywheel (Martin Fowler) — signal type taxonomy maps to feedback tag vocabulary
- Negative Prompts for Image Generation (arXiv 2403.07605) — corrective feedback → avoidance language mapping
- Improving UI Generation from Designer Feedback (arXiv 2509.16779) — text feedback outperforms rating-based RLHF

### Tertiary (LOW confidence)
- Context window performance degradation at 50% fill (factory.ai) — attention dilution rationale for injection cap; mechanism is plausible but specific threshold is not validated for Gemini
- Feedback sparsity in real-world AI systems (WildFeedback dataset) — 3.89% feedback rate cited as baseline; not directly comparable to single-designer internal tool usage

---
*Research completed: 2026-04-14*
*Ready for roadmap: yes*
