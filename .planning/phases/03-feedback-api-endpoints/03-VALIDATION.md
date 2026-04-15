---
phase: 03
slug: feedback-api-endpoints
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript type check (npx tsc --noEmit) |
| **Config file** | tsconfig.json |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | API-01 | T-03-01 | Zod validates input before DB insert | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 03-01-02 | 01 | 1 | API-02, API-03 | T-03-02 | Category/theme filters parameterized via SQL | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 03-01-03 | 01 | 1 | API-04 | T-03-03 | Re-embedding only when feedbackText changes | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 03-01-04 | 01 | 1 | API-05 | T-03-04 | DELETE removes both DB row and vector | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST creates embedding via Gemini | API-01 | Requires live Gemini API key | POST to /api/feedback with valid body, check DB for non-null embedding_vector |
| GET filters by category+theme | API-03 | Requires DB with test data | GET /api/feedback?category=Necklace&theme=BRP |
| PUT re-embeds on text change | API-04 | Requires live Gemini API | PUT with changed feedbackText, verify new embedding |
| DELETE returns 404 on re-GET | API-05 | Requires live server | DELETE then GET same ID |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
