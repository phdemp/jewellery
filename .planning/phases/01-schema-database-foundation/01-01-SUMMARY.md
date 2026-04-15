---
phase: 01-schema-database-foundation
plan: 01
subsystem: shared/schema
tags: [schema, database, drizzle, pgvector, feedback]
dependency_graph:
  requires: []
  provides: [designFeedback-table, insertDesignFeedbackSchema, InsertDesignFeedback-type, DesignFeedback-type]
  affects: [server/storage.ts, server/routes.ts, shared/schema.ts]
tech_stack:
  added: []
  patterns: [drizzle-pgTable, createInsertSchema-omit-extend, pgvector-3072, nullable-FK-SET-NULL]
key_files:
  created: []
  modified: [shared/schema.ts]
decisions:
  - sentiment as text column with Zod enum (not DB pgEnum) for flexibility
  - updatedAt requires explicit set on UPDATE (Drizzle has no $onUpdate trigger)
  - FK constraint added manually via ALTER TABLE due to Drizzle Kit push error on existing table
metrics:
  duration_seconds: 344
  completed: 2026-04-15T06:10:00Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 01 Plan 01: Design Feedback Schema Summary

design_feedback table with 10 columns, nullable FK to design_projects (ON DELETE SET NULL), Zod insert schema with sentiment enum, and pgvector(3072) embedding column -- all using existing Drizzle patterns

## What Was Built

### Table: `design_feedback` (10 columns)

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | varchar PK | NO | gen_random_uuid() | UUID auto-generated |
| design_project_id | varchar FK | YES | null | References design_projects.id, ON DELETE SET NULL |
| feedback_text | text | NO | - | Designer's free-text feedback |
| category | text | NO | - | Hard filter key (e.g. "Necklace Set") |
| theme | text | NO | - | Hard filter key (e.g. "BRP") |
| tags | text[] | NO | '{}'::text[] | Parameter tags for retrieval |
| sentiment | text | NO | 'corrective' | "positive" or "corrective" (Zod-enforced) |
| embedding_vector | vector(3072) | YES | null | Populated after Gemini text-embedding-004 call |
| created_at | timestamp | NO | now() | Immutable |
| updated_at | timestamp | NO | now() | Must be set explicitly on every UPDATE |

### Exported Types and Schemas

```typescript
// Table definition
export const designFeedback = pgTable("design_feedback", { ... });

// Insert schema (omits id, createdAt, updatedAt; extends with sentiment enum + optional vector)
export const insertDesignFeedbackSchema = createInsertSchema(designFeedback).omit({
  id: true, createdAt: true, updatedAt: true,
}).extend({
  embeddingVector: z.array(z.number()).nullable().optional(),
  sentiment: z.enum(["positive", "corrective"]).default("corrective"),
});

// TypeScript types
export type InsertDesignFeedback = z.infer<typeof insertDesignFeedbackSchema>;
export type DesignFeedback = typeof designFeedback.$inferSelect;
```

## Decisions Made

1. **Sentiment as text, not DB enum:** Using a plain text column with Zod enum constraint at the application layer. This avoids the complexity of pgEnum migrations if sentiment values need to change later. The Zod schema enforces `"positive" | "corrective"` at insert time.

2. **updatedAt requires explicit setting:** Drizzle ORM has no `$onUpdate` trigger equivalent. Phase 3's `updateFeedback()` storage method must set `updatedAt: new Date()` on every UPDATE call. A code comment documents this.

3. **FK constraint added manually:** The `npm run db:push` (Drizzle Kit push) encountered a `column "id" is in a primary key` error because the `design_feedback` table already existed in the database (from a prior push or manual creation). The FK constraint was added via `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE SET NULL`. This is functionally equivalent and the schema definition in `shared/schema.ts` correctly declares the FK for Drizzle ORM's query builder.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] db:push PK conflict on existing table**
- **Found during:** Task 2
- **Issue:** `npm run db:push` failed with `error: column "id" is in a primary key` because the `design_feedback` table already existed in the database. Drizzle Kit was trying to reconcile schema differences and hit a PK constraint error.
- **Fix:** Verified the existing table had all 10 columns with correct types. Added the missing FK constraint manually via `ALTER TABLE design_feedback ADD CONSTRAINT design_feedback_design_project_id_design_projects_id_fk FOREIGN KEY (design_project_id) REFERENCES design_projects(id) ON DELETE SET NULL`.
- **Files modified:** None (database-only change)
- **Commit:** N/A (database operation, not a code change)

## Verification Results

All 4 Phase 1 success criteria confirmed:

| # | Criterion | Result |
|---|-----------|--------|
| 1 | design_feedback table exists in PostgreSQL | PASS - 10 columns verified |
| 2 | TypeScript imports compile without errors | PASS - `npx tsc --noEmit` exits 0 |
| 3 | INSERT with null designProjectId succeeds | PASS - FK is nullable, ON DELETE SET NULL confirmed |
| 4 | embedding_vector accepts vector(3072) | PASS - 3072-dim vector stored and dimension verified |

### Additional Checks

| Check | Result |
|-------|--------|
| `export const designFeedback` exists | Line 216 |
| `onDelete: "set null"` in FK definition | Line 220 |
| `export const insertDesignFeedbackSchema` exists | Line 235 |
| `export type InsertDesignFeedback` exists | Line 244 |
| `export type DesignFeedback` exists | Line 246 |
| Only one `const vector = customType` definition | Count: 1 (no duplication) |
| designProjectId NOT .notNull() in feedback block | Confirmed nullable |

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add designFeedback table and Zod schemas | 552b667 | shared/schema.ts |
| 2 | Push schema to PostgreSQL and verify | N/A (DB operation only) | - |

## Self-Check: PASSED

All files exist, all commits found, all exports verified.
