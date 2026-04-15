---
phase: 04-prompt-enrichment-hook
plan: 01
subsystem: api
tags: [feedback, rag, prompt-injection, pgvector, gemini-embeddings, sanitization]

requires:
  - phase: 02-feedback-vector-store-module
    provides: searchSimilarFeedback function for pgvector similarity search on design_feedback table
  - phase: 03-feedback-api-endpoints
    provides: feedback CRUD endpoints that populate design_feedback table with embedded feedback

provides:
  - retrieveFeedbackForPrompt helper that embeds query, searches pgvector, sanitizes text, formats as EMPHASIZE/AVOID blocks
  - sanitizeFeedbackText helper that strips control characters and prompt injection patterns
  - Feedback injection in all 4 generation endpoints (generate-design, modify-design, generate-cad-comparison, generate-marketing)

affects: [05-feedback-ui-panel, 06-verification]

tech-stack:
  added: []
  patterns: [feedback-enrichment-pattern, sanitize-before-inject, enriched-vs-clean-prompt-separation]

key-files:
  created: []
  modified:
    - server/routes.ts

key-decisions:
  - "Positive feedback formatted as EMPHASIZE, corrective as AVOID -- clear semantic signal for AI models"
  - "Enriched prompts only sent to AI models, clean prompts stored in DB and returned in responses"
  - "Marketing endpoint uses 'Marketing' as theme for feedback retrieval since marketing projects use that theme"
  - "500-char truncation per feedback entry prevents context window bloat"

patterns-established:
  - "Feedback enrichment pattern: retrieve -> sanitize -> format -> append to prompt, never throw"
  - "Clean vs enriched prompt separation: AI sees feedback, DB/user sees clean prompt"
  - "Sanitization before injection: strip control chars, instruction-like patterns, truncate"

requirements-completed: [ENRICH-01, ENRICH-02, ENRICH-03, ENRICH-04]

duration: 7min
completed: 2026-04-15
---

# Phase 4 Plan 1: Prompt Enrichment Hook Summary

**Feedback retrieval wired into all 4 generation endpoints with sanitized EMPHASIZE/AVOID prompt injection via pgvector similarity search**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T09:43:45Z
- **Completed:** 2026-04-15T09:50:44Z
- **Tasks:** 5
- **Files modified:** 1 (server/routes.ts)

## Accomplishments
- Created `sanitizeFeedbackText()` helper that strips control characters, prompt injection patterns ("ignore previous instructions"), and truncates to 500 chars
- Created `retrieveFeedbackForPrompt()` helper that embeds query via Gemini, searches pgvector for matching feedback, formats as EMPHASIZE/AVOID blocks, catches all errors silently
- Wired feedback injection into generate-design endpoint (both sketch and CAD mode paths)
- Wired feedback injection into modify-design endpoint (all 3 model prompts: Gemini, OpenAI, Grok)
- Wired feedback injection into generate-cad-comparison endpoint (all 3 model prompts)
- Wired feedback injection into generate-marketing endpoint (all 3 model prompts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add searchSimilarFeedback import and create helper functions** - `e5bb82f` (feat)
2. **Task 2: Wire feedback injection into generate-design endpoint** - `75ad14f` (feat)
3. **Task 3: Wire feedback injection into modify-design endpoint** - `dda757c` (feat)
4. **Task 4: Wire feedback injection into generate-cad-comparison endpoint** - `4b40e3a` (feat)
5. **Task 5: Wire feedback injection into generate-marketing endpoint** - `a665b5f` (feat)

## Files Created/Modified
- `server/routes.ts` - Added searchSimilarFeedback import, sanitizeFeedbackText() and retrieveFeedbackForPrompt() helpers, feedback injection in all 4 generation endpoints

## Decisions Made
- Positive feedback formatted as "EMPHASIZE: [text]", corrective as "AVOID: [text]" -- clear semantic signal for AI models
- Enriched prompts only sent to AI models; clean prompts stored in DB and returned in API responses -- feedback is invisible to users
- Marketing endpoint uses "Marketing" as theme parameter for feedback retrieval since marketing design_projects are stored with theme "Marketing"
- 500-char truncation per feedback entry to prevent context window bloat (max 5 entries = max 2500 chars of feedback)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 generation endpoints now silently inject relevant past feedback into AI prompts
- Ready for Phase 5 (feedback UI panel) which will provide the interface for designers to submit feedback
- Feedback pipeline is end-to-end functional: submit feedback (Phase 3) -> embed + store (Phase 2) -> retrieve + inject (Phase 4)

## Self-Check: PASSED

- FOUND: server/routes.ts
- FOUND: 04-01-SUMMARY.md
- FOUND: e5bb82f (Task 1)
- FOUND: 75ad14f (Task 2)
- FOUND: dda757c (Task 3)
- FOUND: 4b40e3a (Task 4)
- FOUND: a665b5f (Task 5)

---
*Phase: 04-prompt-enrichment-hook*
*Completed: 2026-04-15*
