# Phase 1: Validation Protocol

**Phase:** 01-schema-database-foundation
**Created:** 2026-04-14

---

## Overview

Phase 1 is a purely additive schema change — no existing code is modified except adding
`createSelectSchema` to the drizzle-zod import. Validation therefore uses two tiers:
automated TypeScript compile (SCHEMA-03) and manual SQL verification (SCHEMA-01, SCHEMA-02).

No test runner is configured in this project (Wave 0 gap). `npm run check` is the sole
automated gate.

---

## Automated Validation

### SCHEMA-03 — Zod schema exports compile

```bash
npm run check
```

- **Expected exit code:** 0
- **What it proves:** `insertDesignFeedbackSchema`, `selectDesignFeedbackSchema`,
  `InsertDesignFeedback`, and `DesignFeedback` are valid TypeScript exports with no
  type errors. Also validates that `createSelectSchema` is correctly imported from
  `drizzle-zod`.
- **Run:** After Task 1 (schema edit), and again after Task 2 (db:push).

---

## Manual SQL Verification

### SCHEMA-01 — Table exists with correct columns

After `npm run db:push` completes, run the following in psql:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'design_feedback'
ORDER BY ordinal_position;
```

Expected columns (10 total):

| column_name         | data_type                   | is_nullable |
|---------------------|-----------------------------|-------------|
| id                  | character varying           | NO          |
| design_project_id   | character varying           | YES         |
| feedback_text       | text                        | NO          |
| category            | text                        | NO          |
| theme               | text                        | NO          |
| tags                | ARRAY                       | NO          |
| sentiment           | text                        | NO          |
| embedding_vector    | USER-DEFINED (vector)       | YES         |
| created_at          | timestamp without time zone | NO          |
| updated_at          | timestamp without time zone | NO          |

### SCHEMA-02 — Nullable FK with ON DELETE SET NULL

```sql
-- Test INSERT with null design_project_id
INSERT INTO design_feedback (feedback_text, category, theme, tags, sentiment)
VALUES ('Validation test row', 'Necklace Set', 'BRP', '{stones}', 'corrective');

-- Confirm null FK accepted
SELECT id, design_project_id, feedback_text, sentiment, created_at, updated_at
FROM design_feedback
WHERE feedback_text = 'Validation test row'
LIMIT 1;
-- Expected: design_project_id = NULL

-- Confirm vector(3072) column works
UPDATE design_feedback
SET embedding_vector = (
  '[' || array_to_string(array_fill(0.1::float8, ARRAY[3072]), ',') || ']'
)::vector
WHERE feedback_text = 'Validation test row';
-- Expected: UPDATE 1

-- Clean up
DELETE FROM design_feedback WHERE feedback_text = 'Validation test row';
```

---

## Wave 0 Gaps

- [ ] No automated test runner configured — `npm test` has no test suite for schema changes.
      Manual SQL verification is the fallback for SCHEMA-01 and SCHEMA-02.
- [ ] TypeScript compile (`npm run check`) is the only automated gate for SCHEMA-03.
- [ ] Future phases adding a test framework should add schema validation tests at that point.

---

## Sampling Schedule

| Trigger | Command | Covers |
|---------|---------|--------|
| After Task 1 (schema edit) | `npm run check` | SCHEMA-03 |
| After Task 2 (db:push) | `npm run check` + manual SQL above | SCHEMA-01, SCHEMA-02, SCHEMA-03 |
| Phase gate (before verify-work) | All of the above | All requirements |

---

## Phase Gate Checklist

Before running `/gsd-verify-work` for Phase 1, confirm all of the following:

- [ ] `npm run check` exits 0
- [ ] `npm run db:push` exits 0
- [ ] `grep "export const designFeedback" shared/schema.ts` — match found
- [ ] `grep "export const insertDesignFeedbackSchema" shared/schema.ts` — match found
- [ ] `grep "export const selectDesignFeedbackSchema" shared/schema.ts` — match found
- [ ] `grep -c "const vector = customType" shared/schema.ts` returns exactly 1
- [ ] Test INSERT with null designProjectId succeeds
- [ ] Vector(3072) UPDATE succeeds
- [ ] Test row deleted after verification
