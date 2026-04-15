---
phase: "03"
plan: "01"
subsystem: feedback-api
tags: [api, crud, feedback, storage, routes, client-wrappers]
dependency_graph:
  requires:
    - "01-01: designFeedback table + Zod schemas in shared/schema.ts"
    - "02-01: feedback-vector-store.ts (addFeedbackVector, updateFeedbackVector)"
  provides:
    - "Feedback CRUD storage methods (IStorage + DatabaseStorage)"
    - "5 REST endpoints: POST/GET/GET/:id/PUT/:id/DELETE/:id /api/feedback"
    - "Typed client fetch wrappers + interfaces for feedback API"
  affects:
    - "Phase 04: prompt enrichment can call searchSimilarFeedback with stored feedback"
    - "Phase 05: inline feedback UI can use createFeedback/updateFeedback/deleteFeedback"
    - "Phase 06: feedback management page can use getFeedbackList with pagination/filters"
tech_stack:
  added: []
  patterns:
    - "Drizzle ORM and() + count() for filtered pagination"
    - "Conditional re-embedding on PUT (only when feedbackText changes)"
    - "Zod safeParse validation on POST endpoint"
    - "URLSearchParams for GET query parameter construction in client"
key_files:
  created: []
  modified:
    - server/storage.ts
    - server/routes.ts
    - client/src/lib/api.ts
decisions:
  - "Embedding is synchronous within POST handler (not background job) — acceptable given Gemini text-embedding-004 latency is <2s"
  - "PUT re-embeds only when feedbackText !== existing.feedbackText — avoids unnecessary Gemini API calls for tag/sentiment-only updates"
  - "GET pagination clamped to max 100 per page via Math.min(100, ...) to prevent abuse"
  - "countFeedback returns Drizzle count() directly (number type) without Number() wrapper"
metrics:
  duration: 230s
  completed: "2026-04-15T07:37:15Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
---

# Phase 3 Plan 1: Feedback API Endpoints Summary

Full CRUD API for design feedback: 6 storage methods, 5 Express routes with Zod validation and conditional Gemini re-embedding, 5 typed client-side fetch wrappers.

## Tasks Completed

### Task 1: Add feedback CRUD methods to IStorage and DatabaseStorage
- **Commit:** `67ca256`
- **Files:** `server/storage.ts`
- Added `DesignFeedback`, `InsertDesignFeedback`, `designFeedback` imports from `@shared/schema`
- Added `and`, `count` to drizzle-orm imports
- Added 6 methods to `IStorage` interface: `createFeedback`, `getFeedback`, `getAllFeedback`, `countFeedback`, `updateFeedback`, `deleteFeedback`
- Implemented all 6 in `DatabaseStorage` class
- `getAllFeedback` supports page/limit pagination + optional category/theme filtering via `and()`
- `countFeedback` uses Drizzle `count()` with same filter conditions
- `updateFeedback` always sets `updatedAt: new Date()` (no Drizzle $onUpdate trigger per Phase 1 decision)

### Task 2: Add 5 feedback route handlers to routes.ts
- **Commit:** `c9af9ba`
- **Files:** `server/routes.ts`
- Added `insertDesignFeedbackSchema`, `DesignFeedback` to schema import
- Added `addFeedbackVector`, `updateFeedbackVector` import from `./feedback-vector-store` (NOT from `./vector-store`)
- POST `/api/feedback` — Zod validation, create row, embed via Gemini + addFeedbackVector, returns 201
- GET `/api/feedback` — pagination with limit clamped to `Math.min(100, ...)`, optional category/theme filters
- GET `/api/feedback/:id` — single entry or 404
- PUT `/api/feedback/:id` — partial update (feedbackText/tags/sentiment), re-embeds only when `feedbackText !== existing.feedbackText`
- DELETE `/api/feedback/:id` — removes row or 404
- All routes registered BEFORE `return httpServer;`

### Task 3: Add typed client API wrappers for feedback endpoints
- **Commit:** `995961e`
- **Files:** `client/src/lib/api.ts`
- Added `DesignFeedbackEntry` interface (id, designProjectId, feedbackText, category, theme, tags, sentiment, createdAt, updatedAt)
- Added `FeedbackListResponse` interface (data, total, page, limit)
- Added 5 fetch wrappers: `createFeedback`, `getFeedbackList`, `getFeedbackById`, `updateFeedback`, `deleteFeedback`
- All follow existing codebase patterns: typed returns, `.ok` checks, error extraction, proper Content-Type headers

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS (0 errors) |
| Storage Feedback method count | 30 matches (interface + impl + comments) |
| Routes api/feedback count | 5 endpoint registrations |
| Client api/feedback count | 5 fetch wrappers |
| Conditional re-embedding check | `feedbackText !== existing.feedbackText` present |
| Pagination limit clamp | `Math.min(100, ...)` present |
| Correct vector-store import | `from "./feedback-vector-store"` (not vector-store) |
| updatedAt always set | `updatedAt: new Date()` in updateFeedback |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all endpoints are fully wired to storage methods and Gemini embedding.

## Self-Check: PASSED

- All 3 modified files exist on disk
- All 3 task commits found in git log (67ca256, c9af9ba, 995961e)
- SUMMARY.md created at `.planning/phases/03-feedback-api-endpoints/03-01-SUMMARY.md`
