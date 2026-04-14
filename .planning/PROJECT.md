# Design Brain — Feedback & Prompt Learning

## What This Is

A feedback system for the Raniwala 1881 Design Brain application that lets designers give structured text feedback on generated jewellery sketches. Feedback is stored, embedded, and injected into future generation prompts (RAG-style) to continuously improve output quality based on designer preferences.

## Core Value

Every piece of designer feedback makes the next generation better — the system learns what the designer likes and dislikes, producing increasingly aligned results over time.

## Requirements

### Validated

- ✓ 3-model parallel image generation (Gemini + OpenAI + Grok) — existing
- ✓ RAG pipeline with pgvector embeddings — existing
- ✓ Design project persistence with iterations — existing
- ✓ Reference image upload and analysis — existing
- ✓ Multi-page generation (Home, Modify, CAD, Marketing) — existing

### Active

- [ ] Inline feedback text box below each generated image on all generation pages
- [ ] Feedback tagged to parameter categories (stones, motifs, proportions, style, etc.)
- [ ] Feedback stored in database with design project association
- [ ] Feedback text embedded via Gemini text-embedding-004 for vector search
- [ ] Future prompts enriched with matching past feedback (filter by category+theme, rank by vector similarity)
- [ ] All matching feedback injected into generation prompts
- [ ] Dedicated feedback history/management page (browse, edit, delete)
- [ ] Feedback works on all 4 generation pages (Home, Modify, CAD Comparison, Marketing)

### Out of Scope

- Star ratings / thumbs up-down — text feedback only for v1
- Multi-user feedback (reviewer/manager roles) — single designer for now
- Automated rule extraction from feedback patterns — v2 feature
- Feedback on individual model outputs (Gemini vs OpenAI vs Grok) — feedback is on the design, not per model

## Context

**Existing infrastructure to leverage:**
- pgvector already set up with 3072-dim embeddings for reference images
- `generateTextEmbedding()` in google-client.ts already converts text to 3072-dim vectors
- `searchSimilarVectors()` already supports cosine similarity search
- `buildDesignContext()` and `buildImagePrompt()` already assemble prompts — feedback injection hooks here
- Design projects already stored with category, theme, motifs, stones parameters
- All 4 generation pages already have result display components

**Brownfield context:**
- Existing codebase mapped in `.planning/codebase/`
- 7 pages, 17+ API endpoints, 3 AI providers
- Drizzle ORM with PostgreSQL — will need new schema table for feedback
- Pattern: new features follow the add-page + add-endpoint checklists in CLAUDE.md

## Constraints

- **Tech stack**: Must use existing stack (React + Express + Drizzle + pgvector + Gemini embeddings)
- **Hosting**: Replit, single port 5000
- **AI provider**: Gemini text-embedding-004 for feedback embeddings (same as reference images)
- **No new dependencies**: Use existing libraries (shadcn/ui, React Hook Form, Zod, TanStack Query)
- **Brand aesthetic**: Feedback UI must match existing Raniwala 1881 design language (ornamental dividers, gold/jewel tones)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Inline text box (not rating system) | Designer needs to express specific preferences, not just approve/reject | — Pending |
| Tagged to parameters | Enables precise retrieval — feedback about stones only surfaces for stone-related generations | — Pending |
| Category+theme filter + vector similarity | Balances relevance (same product type) with semantic matching (similar design intent) | — Pending |
| All matching feedback (not top-K) | Designer feedback corpus will be small enough; let AI prioritize from full context | — Pending |
| All 4 pages from start | Consistent experience across all generation workflows | — Pending |
| Dedicated management page | Designer needs to see what the system has learned, correct mistakes | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-14 after initialization*
