# Feature Landscape: Feedback-Driven Prompt Learning

**Domain:** Designer feedback memory system for AI jewellery sketch generation
**Researched:** 2026-04-14
**Context:** Brownfield milestone — adding feedback features to Raniwala 1881 Design Brain

---

## Table Stakes

Features users expect. Missing = the feedback system feels broken or pointless.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Inline feedback text box below generated image | Designer must be able to say what was wrong immediately, in context. Delayed feedback means lost signal. | Low | Exists on all 4 generation pages. Attach to result display component. |
| Feedback stored persistently in DB | Without persistence, feedback disappears on page reload. Trust collapses immediately. | Low | Needs new `design_feedback` table in schema.ts. |
| Feedback influences the very next generation | If a designer submits feedback and the next output ignores it entirely, the feature has no value. The loop must be visibly closed. | Medium | Requires retrieval + prompt injection in all 4 generation endpoints. |
| Visual confirmation that feedback was saved | Designer needs to know it worked — a toast, a count badge, something. Silence after submission creates doubt. | Low | Use existing Sonner toast hook. |
| Ability to delete individual feedback entries | Designers will enter bad feedback, change their mind, or correct typos. No delete = poisoned corpus with no remedy. | Low | Simple DB delete + cache invalidation. |
| Feedback management page (browse all feedback) | Designer needs to see what the system has "learned." Without visibility, the system is a black box and trust erodes. | Medium | New page at `/feedback`, list view with delete. |
| Feedback works on all 4 generation pages | Home, Modify, CAD Comparison, Marketing all generate images. Inconsistent coverage = confusing UX. | Medium | Same component, same API — 4 integration points. |
| Category and theme association on each feedback entry | Enables scoped retrieval — feedback about bridal necklaces should not pollute wearable ring generations. Without this, retrieval degrades fast. | Low | Captured automatically from the design params at submission time. |

---

## Differentiators

Features that set this system apart. Not expected, but increase value significantly.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Vector-similarity retrieval (semantic matching, not keyword) | Finds feedback about "too heavy" polki when the current query mentions "lighter weight design" — semantic match that keyword search would miss. This is the core intelligence of the system. | Medium | Gemini text-embedding-004 already in place. Needs `feedback_vector` column (vector 3072). |
| Feedback tagged to parameter categories (stones, motifs, proportions, style, etc.) | Enables precision filtering before vector search. Narrows retrieval scope to only contextually relevant past feedback. Prevents cross-pollination between unrelated domains. | Low | Designer selects tag(s) at submission time. Small controlled vocabulary: 6-8 tags max. |
| "What the system learned" summary on feedback page | Show a compact auto-generated digest of accumulated feedback themes. Gives designer confidence the AI is incorporating their intent. | High | Requires Gemini summarization call over feedback corpus. Phase 2 feature. |
| Feedback sentiment polarity (positive vs corrective) | Distinguishes "I loved the peacock motif balance" from "the motif is too small." Both are useful but injected differently. Positive reinforcement prompts designer intent; negative corrective prompts inject avoidance language. | Medium | A simple radio button or tone field at submission time. Can be inferred by Gemini if not explicit. |
| Confidence score shown to designer when feedback is retrieved | "3 matching preferences found" displayed before generation. Tells designer the system is working and how much context it has. Reduces anxiety about whether feedback was "heard." | Low | Count of retrieved feedback entries surfaced in UI. |
| Feedback impact transparency (show injected feedback on result page) | After generation, show a collapsible section listing which feedback entries were used. Builds trust and lets designer correct bad retrievals. | Medium | Requires returning retrieved feedback IDs from API endpoint. |
| Feedback edit (correct/refine past entries) | Designer may want to refine wording without losing the entry. Less critical than delete but reduces re-entry friction. | Low | Simple update endpoint. PUT /api/feedback/:id |
| Time decay in retrieval ranking | Older feedback deprioritized relative to recent feedback. The system naturally adapts as designer's taste evolves. Without decay, old conflicting feedback persists indefinitely. | Medium | Weight by `created_at` recency in retrieval scoring. Soft decay, not hard expiry. |

---

## Anti-Features

Things to deliberately NOT build in v1, with rationale.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Star ratings / thumbs up-down | Binary signals have no semantic content. "Thumbs down" tells the AI nothing actionable. Text forces specificity. Ratings feel like a survey, not a creative tool. | Text-only feedback box. Optionally a polarity tag (positive/corrective). |
| Multi-user feedback (reviewer / manager roles) | Different users have conflicting taste. Mixing feedback without attribution creates an averaging effect that degrades quality for everyone. Role management adds auth complexity with no benefit for single-designer use. | Single designer context. If multi-user becomes real, design isolation by user_id at that point. |
| Automated rule extraction from feedback patterns | Trying to auto-extract rules ("always avoid blue stones with WRD theme") from natural language feedback is unreliable without a large corpus. High engineering cost, brittle output, and confusing when it goes wrong. | Use raw feedback text as RAG context. Let Gemini interpret and apply rules in-context. |
| Per-model feedback (Gemini vs OpenAI vs Grok) | Feedback is about design quality, not which model produced it. Splitting feedback by model thins the corpus and confuses what the designer is reacting to. | Feedback attaches to the design project, not the model result. |
| Automatic feedback application without designer awareness | "Silent" learning where the designer doesn't know the system is using past feedback creates unpredictable outputs. When results feel unexpected, there is no way to debug. | Always show a "preferences active" indicator and expose retrieved feedback count or summaries. |
| Feedback on individual stones/motif elements via image annotation | Spatial annotation (click the part of the sketch that's wrong) is high engineering cost, and jewellery sketches are small enough that text descriptions are unambiguous ("the polki cluster on the left side is too dense"). | Text feedback box. Use parameter tags to narrow scope. |
| Feedback expiry / automatic purge | Automatically deleting old feedback destroys designer intent that may still be valid. Designer should be in control of their corpus. | Soft decay in retrieval ranking. Hard delete only when designer explicitly requests it. |
| Feedback-based model fine-tuning | Fine-tuning Gemini on designer feedback requires large labeled datasets (hundreds of example pairs), Vertex AI pipelines, and significant cost. Far beyond the scope of a RAG-style memory system. | RAG injection is the right approach at this scale. Fine-tuning is a v3+ research question. |

---

## Feature Dependencies

```
Feedback text box (UI)
  → POST /api/feedback (API endpoint)
    → design_feedback table (schema)
      → feedback_vector column (pgvector, 3072-dim)
        → generateTextEmbedding() — already exists
        → Retrieval in generation endpoints
          → Prompt injection in buildDesignContext() / buildImagePromptJSON()
            → Feedback influence on output (closed loop)

Feedback management page (/feedback)
  → GET /api/feedback (list all)
  → DELETE /api/feedback/:id (delete)
  → [Optional] PUT /api/feedback/:id (edit)

Sentiment polarity tag (UI)
  → Stored as field on design_feedback table
  → Influences prompt injection phrasing (positive = reinforce, negative = avoid)

Category+theme filter (retrieval)
  → Depends on: category, theme captured at feedback creation time
  → Applied before vector similarity ranking

"Preferences active" count badge
  → Depends on: retrieval step returning feedback count
  → API response must include retrieved feedback metadata
```

---

## MVP Recommendation

Prioritize these for Phase 1 (minimum viable feedback loop):

1. **Inline feedback text box** on all 4 generation pages — captures signal without friction
2. **`design_feedback` DB table** with category, theme, feedback text, vector column, polarity tag
3. **POST /api/feedback** endpoint — saves text, embeds via `generateTextEmbedding()`, stores vector
4. **Feedback retrieval in generation endpoints** — filter by category+theme, rank by cosine similarity, inject into prompt
5. **"X preferences active" indicator** in result display — closes the loop for the designer
6. **Feedback management page** at `/feedback` — browse, delete

Defer to Phase 2:

- **Feedback edit (PUT /api/feedback/:id):** Low urgency. Designer can delete and re-add.
- **Feedback impact transparency (show injected entries):** Valuable but adds API complexity. Do after core loop is proven.
- **Time decay in ranking:** Corpus will be small for months. Implement when there are enough entries to matter (50+).
- **"What the system learned" summary:** Requires Gemini summarization call over the full corpus. Nice to have, not needed for the loop to function.

---

## Parameter Tag Vocabulary

The controlled vocabulary for tagging feedback to parameter categories. Deliberately narrow — too many tags = analysis paralysis at submission time.

| Tag | What It Covers |
|-----|---------------|
| Motifs | Motif choice, scale, placement, density, combination |
| Stones | Stone type, colour, setting style, placement, proportion |
| Proportions | Overall size, weight feel, element balance, negative space |
| Gold work | Filigree, meenakari, gold coverage, texture, finish |
| Style | Overall aesthetic register — too ornate, too minimal, era feel |
| Layout | Symmetry, arrangement, structural form (e.g. Y-shape vs layered) |
| Line quality | Sketch rendering quality, line weight, level of detail |

---

## UX Patterns That Matter

Findings from Google PAIR research and industry practice on what makes AI feedback UX work:

1. **Feedback must be immediate and low-friction.** A multi-step modal or separate "feedback" screen kills adoption. Text box directly under the image, single submit action.

2. **Designers need visibility into what the system has learned.** Without a management view, the system feels like a black box. The feedback page is not a nice-to-have — it is what makes the system trustworthy.

3. **Negative framing is more actionable than positive framing.** "Do not use heavy gold latticework behind polki" is more useful than "I liked the design." Prompt injection should differentiate: corrective feedback maps to avoidance language in the prompt; positive feedback maps to reinforcement.

4. **Small corpus means high injection.** With under 100 feedback entries, inject all matching feedback (after category+theme filter and similarity threshold). Do not truncate. Gemini's context window can handle it. Only apply top-K cutoff if the corpus exceeds several hundred entries.

5. **Decay is more important than deletion.** Designers rarely go back to delete old feedback. Soft recency weighting (boost entries from last 30 days) keeps the system responsive to evolving taste without requiring maintenance.

---

## Sources

Research basis for these findings:

- [Preference-Guided Prompt Optimization (Promptimizer)](https://arxiv.org/html/2602.13131v1) — MEDIUM confidence. User-driven preference collection guides prompt selection and ranking in subsequent iterations.
- [PromptCharm: Multi-modal feedback loop](https://arxiv.org/html/2403.04014v1) — MEDIUM confidence. Demonstrates that multi-modal refinement (mark undesired parts, regenerate) drives better iteration than simple rating systems.
- [Improving UI Generation from Designer Feedback (arxiv)](https://arxiv.org/abs/2509.16779) — HIGH confidence. Academic finding that designer-aligned feedback (commenting, annotation) outperforms rating-based RLHF. Validates text-over-rating decision.
- [Feedback Flywheel (Martin Fowler)](https://martinfowler.com/articles/reduce-friction-ai/feedback-flywheel.html) — HIGH confidence. The four signal types (context, instruction, workflow, failure) map cleanly onto the feedback category tag vocabulary.
- [Google PAIR Guidebook — Feedback Loops](https://pair.withgoogle.com/guidebook/chapters/feedback-and-controls/design-ai-feedback-loops) — HIGH confidence. Visibility and control are the two requirements that make AI feedback loops trustworthy.
- [RAG Memory with hybrid retrieval (Morphik/Qdrant)](https://www.morphik.ai/blog/retrieval-augmented-generation-strategies) — MEDIUM confidence. Hybrid retrieval (embedding similarity + metadata filters) is the established pattern for small-corpus memory systems.
- [Hindsight: Agent Memory That Learns](https://github.com/vectorize-io/hindsight) — MEDIUM confidence. When AI fails or user corrects, that becomes an experience. User corrections are the highest-value training signal.
- [Negative Prompts for Image Generation](https://arxiv.org/abs/2403.07605) — HIGH confidence. Validated that corrective feedback maps to avoidance (negative prompt) language, positive feedback maps to reinforcement language.
