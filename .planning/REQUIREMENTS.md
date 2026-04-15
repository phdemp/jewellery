# Requirements: Design Brain — Feedback & Prompt Learning

**Defined:** 2026-04-14
**Core Value:** Every piece of designer feedback makes the next generation better

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Feedback Schema

- [ ] **SCHEMA-01**: New `design_feedback` table with id, designProjectId, feedbackText, category, theme, tags (text[]), sentiment (positive/corrective), embeddingVector (vector 3072), createdAt, updatedAt
- [ ] **SCHEMA-02**: Foreign key from design_feedback.designProjectId to design_projects.id with ON DELETE SET NULL
- [ ] **SCHEMA-03**: Zod insert/select schemas exported from shared/schema.ts

### Feedback Submission

- [ ] **SUBMIT-01**: Designer can type free-form text feedback in an inline text box below each generated image
- [ ] **SUBMIT-02**: Designer can tag feedback to parameter categories (stones, motifs, proportions, style, layout, overall)
- [ ] **SUBMIT-03**: Feedback is automatically associated with the design project that generated the image
- [ ] **SUBMIT-04**: Designer can mark feedback as positive reinforcement or corrective
- [ ] **SUBMIT-05**: Feedback submission works on all 4 generation pages (Home, Modify, CAD Comparison, Marketing)
- [ ] **SUBMIT-06**: Feedback text is embedded via Gemini text-embedding-004 and stored as pgvector

### Feedback Storage & Retrieval

- [x] **STORE-01**: Dedicated feedback-vector-store module with add, search, delete, update operations
- [x] **STORE-02**: Search filters by category AND theme before ranking by cosine similarity
- [x] **STORE-03**: Similarity threshold gate (0.75 minimum) prevents irrelevant feedback from being retrieved
- [x] **STORE-04**: Error in feedback retrieval never blocks image generation (try/catch isolation)

### Prompt Enrichment

- [x] **ENRICH-01**: All 4 generation endpoints retrieve matching feedback and inject into prompts
- [x] **ENRICH-02**: Feedback injected via buildImagePromptJSON() extras as designer_feedback key
- [x] **ENRICH-03**: Corrective feedback framed as "AVOID: [text]", positive feedback framed as "EMPHASIZE: [text]"
- [x] **ENRICH-04**: Feedback injection is sanitized to prevent prompt injection attacks (strip control sequences, limit length)

### Feedback API

- [x] **API-01**: POST /api/feedback — create feedback entry with text, tags, sentiment, embed text
- [x] **API-02**: GET /api/feedback — list all feedback with pagination support
- [x] **API-03**: GET /api/feedback?category=X&theme=Y — filter feedback by category and/or theme
- [x] **API-04**: PUT /api/feedback/:id — update feedback text, tags, or sentiment (re-embed on text change)
- [x] **API-05**: DELETE /api/feedback/:id — delete feedback entry and its vector

### Feedback Management UI

- [ ] **MGMT-01**: Dedicated /feedback page accessible from main navigation
- [ ] **MGMT-02**: Browse all past feedback entries in a card/table layout
- [ ] **MGMT-03**: Filter feedback by category, theme, sentiment, and date range
- [ ] **MGMT-04**: Edit feedback text, tags, and sentiment inline or in a modal
- [ ] **MGMT-05**: Delete individual feedback entries with confirmation dialog
- [ ] **MGMT-06**: Each feedback card shows the linked design project (thumbnail + category + theme)

## v2 Requirements

### Feedback Intelligence

- **INTEL-01**: Time decay weighting — older feedback has less influence on new generations
- **INTEL-02**: "Impact" indicator showing how often each feedback entry was used in generations
- **INTEL-03**: AI-generated summary of what the system has learned (Gemini synthesis of all feedback)
- **INTEL-04**: Auto-suggest parameter tags based on feedback text content
- **INTEL-05**: Feedback templates/quick phrases for common corrections

### Multi-User

- **MULTI-01**: Reviewer/manager can add feedback alongside designer
- **MULTI-02**: Role-based feedback weighting (manager feedback carries more weight)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Star ratings / thumbs up-down | Text feedback captures richer intent; academic research validates text over ratings |
| Per-model feedback (Gemini vs OpenAI vs Grok) | Dilutes corpus, complicates retrieval; feedback is about the design, not the model |
| Fine-tuning / model training | Scale mismatch — feedback corpus too small for fine-tuning; prompt enrichment is the right approach |
| Automated rule extraction | v2 feature — requires pattern detection across feedback corpus |
| Background/async embedding | Sync embedding is fast enough for single-entry submissions; optimize only if needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHEMA-01 | Phase 1 | Pending |
| SCHEMA-02 | Phase 1 | Pending |
| SCHEMA-03 | Phase 1 | Pending |
| SUBMIT-01 | Phase 5 | Pending |
| SUBMIT-02 | Phase 5 | Pending |
| SUBMIT-03 | Phase 5 | Pending |
| SUBMIT-04 | Phase 5 | Pending |
| SUBMIT-05 | Phase 5 | Pending |
| SUBMIT-06 | Phase 5 | Pending |
| STORE-01 | Phase 2 | Complete |
| STORE-02 | Phase 2 | Complete |
| STORE-03 | Phase 2 | Complete |
| STORE-04 | Phase 2 | Complete |
| ENRICH-01 | Phase 4 | Complete |
| ENRICH-02 | Phase 4 | Complete |
| ENRICH-03 | Phase 4 | Complete |
| ENRICH-04 | Phase 4 | Complete |
| API-01 | Phase 3 | Complete |
| API-02 | Phase 3 | Complete |
| API-03 | Phase 3 | Complete |
| API-04 | Phase 3 | Complete |
| API-05 | Phase 3 | Complete |
| MGMT-01 | Phase 6 | Pending |
| MGMT-02 | Phase 6 | Pending |
| MGMT-03 | Phase 6 | Pending |
| MGMT-04 | Phase 6 | Pending |
| MGMT-05 | Phase 6 | Pending |
| MGMT-06 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after roadmap creation — all 28 requirements mapped*
