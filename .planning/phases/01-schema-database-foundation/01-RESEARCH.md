# Phase 1: Schema & Database Foundation - Research

**Researched:** 2026-04-14
**Domain:** Drizzle ORM schema extension + pgvector table creation
**Confidence:** HIGH

## Summary

Phase 1 adds a single new table (`design_feedback`) to an existing PostgreSQL + pgvector + Drizzle ORM codebase. All tooling, patterns, and the pgvector extension are already in production. This is purely additive — no existing tables, routes, or files are modified. The only risk is a column-spec discrepancy between the two upstream research documents (STACK.md vs REQUIREMENTS.md) regarding `sentiment` and `updatedAt`, which is resolved below.

The phase completes when `npm run db:push` creates the table, TypeScript types compile cleanly, and the three Zod schemas are importable from `shared/schema.ts`.

**Primary recommendation:** Mirror the existing `referenceImages` table pattern exactly — same `customType` vector, same UUID PK default, same `createInsertSchema` + `omit` + `extend` Zod pattern.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHEMA-01 | New `design_feedback` table with: id, designProjectId, feedbackText, category, theme, tags (text[]), sentiment (positive/corrective), embeddingVector (vector 3072), createdAt, updatedAt | Column-by-column spec in Standard Stack section; existing `vector` customType reused |
| SCHEMA-02 | FK from design_feedback.designProjectId to design_projects.id with ON DELETE SET NULL | Drizzle `.references(() => designProjects.id, { onDelete: "set null" })` — see Code Examples |
| SCHEMA-03 | Zod insert/select schemas exported from shared/schema.ts: `designFeedback`, `insertDesignFeedbackSchema`, `selectDesignFeedbackSchema` | Three-export pattern documented in Code Examples; mirrors existing `referenceImages` exports |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **No `any` types** — define proper TypeScript interfaces
- **Single source of truth:** `shared/schema.ts` — all DB tables and Zod validators live here
- **Do not modify:** `server/db.ts`, `server/vite.ts`, `vite.config.ts`, `tsconfig.json`, `drizzle.config.ts`
- **Run `npm run check` after every TypeScript change**
- **No new dependencies** — use existing libraries only (stated in STACK.md project constraint)
- **Schema migration path:** `npm run db:push` only — do NOT use `drizzle-kit generate` + `drizzle-kit migrate`

---

## Standard Stack

### Core (all existing — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.39.3 | Table definition + query builder | Already in production; `pgTable`, `customType` already used |
| `drizzle-zod` | 0.7.0 | Auto-generate Zod schemas from Drizzle tables | Already used for all 4 existing tables |
| `drizzle-kit` | 0.31.4 | Schema push via `npm run db:push` | Already configured in `drizzle.config.ts` |
| `zod` | 3.25.76 | Schema validation + TypeScript type inference | Mandatory per CLAUDE.md |
| `pg` | 8.16.3 | PostgreSQL driver (used by Drizzle) | Existing |

**No installation needed** — all packages already in `package.json`. [VERIFIED: direct inspection of STACK.md + project package.json references]

---

## Architecture Patterns

### Existing Table Pattern to Mirror

The `referenceImages` table in `shared/schema.ts` is the exact template. It uses:
1. `customType` for the `vector(3072)` column (defined once at top of file — reuse, do not redefine)
2. `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)` for UUID PK
3. `timestamp("created_at").defaultNow().notNull()` for audit timestamps
4. `createInsertSchema(table).omit({ id: true, ... }).extend({ embeddingVector: z.array(z.number()).nullable().optional() })` for Zod schema

### Column Spec Reconciliation (SCHEMA-01)

REQUIREMENTS.md specifies columns that STACK.md's schema example omits. The planner MUST include all REQUIREMENTS.md columns. Resolved spec:

| Column (camelCase) | DB Column | Type | Nullable | Notes |
|-------------------|-----------|------|----------|-------|
| `id` | `id` | `varchar PK` | No | UUID via `gen_random_uuid()` |
| `designProjectId` | `design_project_id` | `varchar FK` | Yes (SET NULL) | FK to `design_projects.id` |
| `feedbackText` | `feedback_text` | `text` | No | Free-form designer text |
| `category` | `category` | `text` | No | e.g. "Necklace Set" — hard filter key |
| `theme` | `theme` | `text` | No | e.g. "BRP" — hard filter key |
| `tags` | `tags` | `text[]` | No | Default `'{}'::text[]` |
| `sentiment` | `sentiment` | `text` | No | One of: `"positive"` \| `"corrective"` |
| `embeddingVector` | `embedding_vector` | `vector(3072)` | Yes | Null until embedding is generated |
| `createdAt` | `created_at` | `timestamp` | No | `defaultNow()` |
| `updatedAt` | `updated_at` | `timestamp` | No | `defaultNow()` — needs manual update on PUT |

**Sentinel values for `sentiment`:** Use plain `text` column (not a Drizzle `pgEnum`). Reason: the existing schema uses `text` for all constrained-value columns (e.g. `status`, `themeCode`). Enum would require a separate DDL type, which `db:push` handles but adds complexity not needed at this scale. Zod validation (`z.enum(["positive", "corrective"])`) provides the constraint at the application layer. [ASSUMED — no explicit decision recorded in STATE.md or CONTEXT.md]

**`updatedAt` auto-update:** Drizzle ORM does NOT automatically update `updated_at` on row mutation. The `storage.ts` update method must explicitly set `updatedAt: new Date()`. [VERIFIED: existing codebase uses no auto-update triggers; this is standard Drizzle ORM behavior]

### FK: ON DELETE SET NULL

REQUIREMENTS.md (SCHEMA-02) specifies `ON DELETE SET NULL`. ARCHITECTURE.md also uses SET NULL. STACK.md's code example incorrectly shows `{ onDelete: "cascade" }`. **The requirement wins: use `{ onDelete: "set null" }`.** This requires the column to be nullable (no `.notNull()`).

[VERIFIED: REQUIREMENTS.md SCHEMA-02 explicit; ARCHITECTURE.md schema section confirms SET NULL; Drizzle ORM syntax verified against existing `designIterations` table which uses `.references(() => designProjects.id)` without onDelete — SET NULL must be specified explicitly]

### Zod Schema Export Pattern (SCHEMA-03)

REQUIREMENTS.md names three exports: `designFeedback`, `insertDesignFeedbackSchema`, `selectDesignFeedbackSchema`.

Note: `designFeedback` is the Drizzle table object itself (not a Zod schema). The naming matches how `referenceImages` (table object) and `insertReferenceImageSchema` (Zod) coexist. `selectDesignFeedbackSchema` is the select-side Zod schema — derive with `createSelectSchema` from `drizzle-zod` OR use `typeof designFeedback.$inferSelect`.

[ASSUMED: `selectDesignFeedbackSchema` is intended as a Zod schema, not just the inferred type. The existing codebase does not use `createSelectSchema` anywhere — it uses `$inferSelect` for TypeScript types only. The planner should use `z.object({...})` wrapping `designFeedback.$inferSelect` fields, OR simply export `typeof designFeedback.$inferSelect` as `SelectDesignFeedback` type and name it `selectDesignFeedbackSchema`. Confirm with user if strict Zod schema is needed vs TypeScript type.]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom UUID function | `sql\`gen_random_uuid()\`` | Already in use for all 4 tables |
| vector(3072) column | New `customType` definition | Reuse existing `vector` customType at top of `shared/schema.ts` | Already defined — redefining creates duplicate type |
| Schema migration | Manual `CREATE TABLE` SQL | `npm run db:push` | Drizzle handles diff; pgvector extension already installed |
| Insert schema validation | Manual Zod `.object({...})` | `createInsertSchema(designFeedback).omit({...}).extend({...})` | `drizzle-zod` auto-generates from table definition |

**Key insight:** The entire `vector` customType infrastructure (including the `toDriver`/`fromDriver` serialization for the `[1,2,3,...]` format) is already solved and tested in production. Do not recreate it.

---

## Common Pitfalls

### Pitfall 1: Redefining the `vector` customType
**What goes wrong:** Defining a second `const vector = customType<...>({...})` in `shared/schema.ts` creates a duplicate identifier compile error or shadows the existing definition.
**Why it happens:** Researcher/planner didn't check what's already at the top of the file.
**How to avoid:** The `vector` customType is defined at line 7-19 of `shared/schema.ts`. The new table simply calls `vector("embedding_vector")` — same as `referenceImages` and `stockItems`.
**Warning signs:** TypeScript error "Cannot redeclare block-scoped variable 'vector'".

### Pitfall 2: Using `onDelete: "cascade"` instead of `onDelete: "set null"`
**What goes wrong:** Deleting a `design_project` cascades and silently deletes all its feedback, losing designer preference data.
**Why it happens:** STACK.md's code example used "cascade" (incorrectly — contradicts REQUIREMENTS.md and ARCHITECTURE.md).
**How to avoid:** Use `.references(() => designProjects.id, { onDelete: "set null" })` and do NOT add `.notNull()` to the `designProjectId` column.
**Warning signs:** `db:push` succeeds but a DELETE on `design_projects` removes feedback rows.

### Pitfall 3: Forgetting `updated_at` requires explicit application-layer update
**What goes wrong:** `updatedAt` stays at creation timestamp after PUT operations, making it useless as an audit field.
**Why it happens:** Drizzle ORM has no `$onUpdate` trigger equivalent in this codebase; PostgreSQL triggers are not used.
**How to avoid:** The Phase 3 storage method for `updateFeedback()` must explicitly include `updatedAt: new Date()` in every update call.
**Warning signs:** Querying `updated_at` after a PUT returns the original `created_at` value.

### Pitfall 4: `db:push` Without DATABASE_URL in Environment
**What goes wrong:** `drizzle.config.ts` throws "DATABASE_URL, ensure the database is provisioned" before push runs.
**Why it happens:** The `.env` file is not auto-loaded by `drizzle-kit push`.
**How to avoid:** Run as `npm run db:push` (the npm script loads `.env` via `cross-env`). Do NOT run `npx drizzle-kit push` directly.

### Pitfall 5: `createSelectSchema` Not Available
**What goes wrong:** `drizzle-zod` 0.7.0 may export `createSelectSchema` — but the existing codebase never uses it. Attempting to import it may fail if not exported by this version.
**Why it happens:** `drizzle-zod` API changed between versions; the project only uses `createInsertSchema`.
**How to avoid:** For the select schema, use `z.object({})` manually or derive from `$inferSelect`. Verify with `npm run check` immediately after adding the import.

---

## Code Examples

### Table Definition (matches existing pattern)
```typescript
// Source: mirrors shared/schema.ts referenceImages + stockItems pattern

export const designFeedback = pgTable("design_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  designProjectId: varchar("design_project_id")
    .references(() => designProjects.id, { onDelete: "set null" }),
  // Note: NOT .notNull() — must be nullable for ON DELETE SET NULL to work
  feedbackText: text("feedback_text").notNull(),
  category: text("category").notNull(),
  theme: text("theme").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  sentiment: text("sentiment").notNull().default("corrective"),
  // "positive" | "corrective" — validated by Zod, not DB enum
  embeddingVector: vector("embedding_vector"),
  // nullable — populated after Gemini embedding call
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### Zod Schema Exports
```typescript
// Source: mirrors insertReferenceImageSchema pattern in shared/schema.ts

export const insertDesignFeedbackSchema = createInsertSchema(designFeedback).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  embeddingVector: z.array(z.number()).nullable().optional(),
  sentiment: z.enum(["positive", "corrective"]).default("corrective"),
});

// selectDesignFeedbackSchema — two valid approaches:
// Option A (TypeScript type only, not Zod):
export type DesignFeedback = typeof designFeedback.$inferSelect;

// Option B (Zod schema for runtime validation):
// export const selectDesignFeedbackSchema = createSelectSchema(designFeedback);
// Use Option A unless a Zod runtime parse is needed on the read path.

export type InsertDesignFeedback = z.infer<typeof insertDesignFeedbackSchema>;
```

### Test INSERT Verification (for success criteria 3)
```sql
-- Run directly in psql or via db.execute() in a test script
INSERT INTO design_feedback
  (feedback_text, category, theme, tags, sentiment)
VALUES
  ('Test feedback entry', 'Necklace Set', 'BRP', '{stones}', 'corrective');
-- design_project_id intentionally null (tests nullable FK — SCHEMA-02)

-- Verify
SELECT id, design_project_id, feedback_text, sentiment, created_at
FROM design_feedback LIMIT 1;
```

### Test vector(3072) INSERT (for success criteria 4)
```sql
-- Verify embedding_vector column accepts 3072-dim vector
UPDATE design_feedback
SET embedding_vector = '[' || array_to_string(array_fill(0.1::float8, ARRAY[3072]), ',') || ']'::vector
WHERE feedback_text = 'Test feedback entry';
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Not established (no test config found in project) |
| Config file | None — Wave 0 gap |
| Quick run command | `npm run check` (TypeScript only) |
| Full suite command | `npm run check && npm run db:push` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHEMA-01 | Table exists with correct columns | manual-only (db:push + psql verify) | `npm run db:push` | N/A |
| SCHEMA-02 | FK is nullable with ON DELETE SET NULL | manual-only (test INSERT with null designProjectId) | psql INSERT | N/A |
| SCHEMA-03 | Zod schemas compile and export correctly | compile | `npm run check` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run check`
- **Per wave merge:** `npm run check && npm run db:push`
- **Phase gate:** All 4 success criteria verified before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] No automated test runner configured — manual SQL verification is the fallback for SCHEMA-01 and SCHEMA-02
- [ ] TypeScript compile (`npm run check`) is the only automated gate for SCHEMA-03

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL + pgvector | `db:push` + vector column | ✓ (assumed — existing app runs) | Unknown | None — blocking |
| `drizzle-kit` | `npm run db:push` | ✓ | 0.31.4 | None — blocking |
| `DATABASE_URL` env var | `drizzle.config.ts` | ✓ (assumed — app runs) | — | None — blocking |

All dependencies confirmed active because the existing app (with `referenceImages` and `stockItems` vector tables) runs in production. [ASSUMED: environment not re-probed in this session — run `npm run check` as first verification step]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `sentiment` column should use `text` type (not pgEnum) with Zod enum validation | Column Spec Reconciliation | If pgEnum is required, need an additional Drizzle `pgEnum()` export and `db:push` creates a new DB type — minor additional step |
| A2 | `selectDesignFeedbackSchema` is satisfied by a TypeScript `$inferSelect` type (not a Zod runtime schema) | Zod Schema Export Pattern | If a Zod runtime parse is required downstream (e.g. Phase 3 API response validation), need to use `createSelectSchema` from drizzle-zod or hand-write the Zod object |
| A3 | `defaultNow()` for `updatedAt` is acceptable (no DB-level trigger) | Column Spec | If Phase 3/4 requires `updated_at` to auto-update on every SQL UPDATE without application code, need a PostgreSQL trigger — adds complexity |
| A4 | Environment has DATABASE_URL loaded and pgvector installed | Environment Availability | If pgvector extension is not installed, `db:push` will fail on `vector(3072)` column — run `CREATE EXTENSION IF NOT EXISTS vector;` first |

---

## Open Questions

1. **Does `selectDesignFeedbackSchema` need to be a Zod runtime schema or a TypeScript type?**
   - What we know: REQUIREMENTS.md says "Zod insert/select schemas" — suggests Zod
   - What's unclear: `createSelectSchema` from `drizzle-zod` exists but is not used anywhere in the codebase
   - Recommendation: Export as TypeScript type (`typeof designFeedback.$inferSelect`) for Phase 1; upgrade to Zod if Phase 3 needs runtime response parsing

2. **Should `sentiment` default to `"corrective"` or be required at insert time?**
   - What we know: REQUIREMENTS.md says "Designer can mark feedback as positive reinforcement or corrective" (SUBMIT-04, Phase 5)
   - What's unclear: Whether the Phase 3 API should enforce sentiment or allow null
   - Recommendation: Add `.default("corrective")` on the Zod insert schema; make the DB column NOT NULL with default — this is safe and matches the field semantics

---

## Sources

### Primary (HIGH confidence)
- `shared/schema.ts` (direct inspection) — existing `vector` customType, `referenceImages` table pattern, `createInsertSchema` usage, all Drizzle column types
- `drizzle.config.ts` (direct inspection) — confirmed `db:push` workflow, schema path, dialect
- `.planning/REQUIREMENTS.md` (direct inspection) — authoritative column spec for SCHEMA-01, SCHEMA-02, SCHEMA-03
- `.planning/research/STACK.md` (direct inspection) — verified library versions, no-new-deps constraint
- `.planning/research/ARCHITECTURE.md` (direct inspection) — FK ON DELETE SET NULL decision, schema SQL

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — pre-phase decisions (sync embedding, SET NULL rationale)

### Tertiary (LOW confidence — training knowledge)
- Drizzle ORM `$onUpdate` / auto-timestamp behavior — training knowledge; flagged as A3

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via direct file inspection
- Architecture (column spec): HIGH — REQUIREMENTS.md is authoritative; discrepancy with STACK.md resolved in favor of requirements
- FK pattern: HIGH — verified against existing `designIterations.designProjectId` pattern
- Zod schema exports: MEDIUM — `selectDesignFeedbackSchema` naming has ambiguity (A2)
- Pitfalls: HIGH — derived from direct codebase inspection

**Research date:** 2026-04-14
**Valid until:** Stable (no external dependencies to go stale — pure Drizzle/PostgreSQL schema work)
