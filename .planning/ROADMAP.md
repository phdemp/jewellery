# Roadmap: Design Brain — Feedback & Prompt Learning

## Overview

This milestone adds a designer feedback memory layer to an existing production RAG pipeline. Six focused phases build in strict dependency order: schema first (unlocks everything), then the vector store module (unlocks retrieval), then the API endpoints (unlocks data entry and the UI), then prompt enrichment (closes the learning loop), then the inline feedback UI across all four generation pages, and finally a dedicated management page where the designer can see and control what the system has learned.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Schema & Database Foundation** - Create the design_feedback table, Zod schemas, and push to PostgreSQL
- [ ] **Phase 2: Feedback Vector Store Module** - Dedicated feedback-vector-store.ts with add, search, delete and similarity threshold gate
- [ ] **Phase 3: Feedback API Endpoints** - Five CRUD endpoints plus DatabaseStorage methods for all feedback operations
- [ ] **Phase 4: Prompt Enrichment Hook** - Wire feedback retrieval into all four generation endpoints with sentiment-aware injection
- [ ] **Phase 5: Inline Feedback UI** - FeedbackForm component mounted below ResultDisplay on all four generation pages
- [ ] **Phase 6: Feedback Management Page** - Dedicated /feedback page with browse, filter, edit, and delete

## Phase Details

### Phase 1: Schema & Database Foundation
**Goal**: The design_feedback table exists in PostgreSQL with correct columns, FK constraint, and TypeScript types available for all downstream modules
**Depends on**: Nothing (first phase)
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03
**Success Criteria** (what must be TRUE):
  1. Running `npm run db:push` succeeds and the design_feedback table appears in the database
  2. TypeScript imports of `designFeedback`, `insertDesignFeedbackSchema`, and `selectDesignFeedbackSchema` from shared/schema.ts compile without errors
  3. A test INSERT into design_feedback with a null designProjectId succeeds (FK is nullable via ON DELETE SET NULL)
  4. The embedding_vector column accepts a vector(3072) value without error
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md — Add designFeedback table + Zod schemas to shared/schema.ts, push to PostgreSQL

### Phase 2: Feedback Vector Store Module
**Goal**: A dedicated server/feedback-vector-store.ts module exists with add, search, delete, and update operations that never touch the reference_images table
**Depends on**: Phase 1
**Requirements**: STORE-01, STORE-02, STORE-03, STORE-04
**Success Criteria** (what must be TRUE):
  1. `addFeedbackVector(id, embedding, category, theme)` stores a vector row and it is queryable
  2. `searchSimilarFeedback(queryEmbedding, category, theme)` returns only rows matching the category AND theme filter — rows from a different category are excluded even if similarity is higher
  3. Results with cosine similarity below 0.75 are never returned (threshold gate confirmed by inserting a clearly dissimilar vector and verifying empty result)
  4. An error thrown inside `searchSimilarFeedback` is caught and returns an empty array without crashing the caller (error isolation confirmed)
  5. `deleteFeedbackVector(id)` removes the row and a subsequent search for that vector returns nothing
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — Create feedback-vector-store.ts with add, search, delete, update functions

### Phase 3: Feedback API Endpoints
**Goal**: Designer can POST feedback entries (which get embedded and stored) and the server exposes GET/PUT/DELETE operations for the management UI to consume
**Depends on**: Phase 2
**Requirements**: API-01, API-02, API-03, API-04, API-05
**Success Criteria** (what must be TRUE):
  1. POST /api/feedback with valid text, tags, sentiment, category, and theme returns 201 with the created feedback id and a Gemini embedding is stored in the DB
  2. GET /api/feedback returns a paginated list of all feedback entries ordered by createdAt descending
  3. GET /api/feedback?category=Necklace&theme=BRP returns only entries matching both filters
  4. PUT /api/feedback/:id with updated feedbackText triggers re-embedding and the updated vector is stored
  5. DELETE /api/feedback/:id removes both the DB row and the vector, and a subsequent GET returns 404 for that id
**Plans**: TBD

### Phase 4: Prompt Enrichment Hook
**Goal**: Every generation on all four pages silently retrieves matching past feedback and injects it into the prompt — the designer sees better outputs without any extra action
**Depends on**: Phase 3
**Requirements**: ENRICH-01, ENRICH-02, ENRICH-03, ENRICH-04
**Success Criteria** (what must be TRUE):
  1. Submitting a generation request when relevant feedback exists causes the server to log "Injecting N feedback entries" to the console
  2. Positive feedback appears in the generated prompt as "EMPHASIZE: [text]" and corrective feedback appears as "AVOID: [text]"
  3. All four endpoints (generate-design, modify-design, generate-cad-comparison, generate-marketing) include feedback injection — verified by checking server logs for each
  4. When Gemini embedding lookup fails during retrieval, the generation still completes normally (no 500 error propagated to the client)
  5. Injected feedback text contains no raw control sequences or instruction-like patterns — sanitization strips them before injection
**Plans**: TBD
**UI hint**: yes

### Phase 5: Inline Feedback UI
**Goal**: Designer can submit structured feedback directly below any generated image without leaving the generation page
**Depends on**: Phase 3
**Requirements**: SUBMIT-01, SUBMIT-02, SUBMIT-03, SUBMIT-04, SUBMIT-05, SUBMIT-06
**Success Criteria** (what must be TRUE):
  1. After any image generation on Home, Modify, CAD Comparison, or Marketing page, a feedback text box appears below the result with sentiment picker and tag multi-select
  2. Designer can type free-form text, select one or more tags (stones, motifs, proportions, style, layout, overall), and mark the feedback as positive or corrective before submitting
  3. Submitting feedback shows a Sonner toast confirming the feedback was saved, and the text box clears
  4. The submitted feedback entry in the DB has the correct designProjectId of the just-generated design automatically attached (not entered by the designer)
  5. The feedback form matches the Raniwala 1881 design language — uses OrnamentalDivider, gold color tokens, shadcn Textarea and Badge components
**Plans**: TBD
**UI hint**: yes

### Phase 6: Feedback Management Page
**Goal**: Designer can browse everything the system has learned, filter by category/theme/sentiment, edit mistakes, and delete poisoned entries
**Depends on**: Phase 5
**Requirements**: MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05, MGMT-06
**Success Criteria** (what must be TRUE):
  1. Navigating to /feedback from the main nav shows all past feedback entries in a card layout with feedbackText, sentiment badge, tags, and createdAt
  2. Each feedback card shows the linked design project thumbnail, category, and theme when a project association exists
  3. Designer can filter the list by category, theme, sentiment, and date range — the list updates without page reload
  4. Designer can edit feedbackText, tags, and sentiment inline or in a modal — saving triggers a PUT request and the card updates in place
  5. Clicking delete on a feedback card shows a confirmation dialog — confirming removes the card from the list immediately
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema & Database Foundation | 0/1 | Not started | - |
| 2. Feedback Vector Store Module | 0/1 | Not started | - |
| 3. Feedback API Endpoints | 0/TBD | Not started | - |
| 4. Prompt Enrichment Hook | 0/TBD | Not started | - |
| 5. Inline Feedback UI | 0/TBD | Not started | - |
| 6. Feedback Management Page | 0/TBD | Not started | - |
