// server/feedback-vector-store.ts
// Dedicated vector operations for design_feedback table.
// Mirrors patterns from server/vector-store.ts but targets a different table.
// CRITICAL: Do NOT import from ./vector-store — those functions target reference_images.

import { db } from "./db";
import { sql } from "drizzle-orm";

export interface SimilarFeedback {
  id: string;
  feedbackText: string;
  sentiment: string;
  tags: string[];
  similarity: number;
}

interface FeedbackVectorRow {
  id: string;
  feedback_text: string;
  sentiment: string;
  tags: string[];
  similarity: string;
}

const SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_TOP_K = 5;

// Add an embedding vector to an existing design_feedback row.
// The category and theme params are accepted for caller context but are NOT used
// in the UPDATE query — the row is identified by id alone (category/theme were
// already set when the row was created by the API endpoint).
export async function addFeedbackVector(
  id: string,
  embedding: number[],
  category: string,
  theme: string
): Promise<void> {
  try {
    const vectorStr = `[${embedding.join(",")}]`;
    await db.execute(
      sql`UPDATE design_feedback SET embedding_vector = ${vectorStr}::vector WHERE id = ${id}`
    );
  } catch (error) {
    console.error("[feedback-vector-store] addFeedbackVector error:", error);
    throw error;
  }
}

// Search for feedback entries similar to a query embedding.
// Filters by category AND theme (mandatory — STORE-02).
// Applies a 0.75 similarity threshold gate (STORE-03).
// Returns empty array on error — never throws (STORE-04).
export async function searchSimilarFeedback(
  queryEmbedding: number[],
  category: string,
  theme: string,
  topK: number = DEFAULT_TOP_K
): Promise<SimilarFeedback[]> {
  try {
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const results = await db.execute(sql`
      SELECT id, feedback_text, sentiment, tags,
             1 - (embedding_vector::halfvec(3072) <=> ${vectorStr}::halfvec(3072)) as similarity
      FROM design_feedback
      WHERE embedding_vector IS NOT NULL
        AND category = ${category}
        AND theme = ${theme}
      ORDER BY embedding_vector::halfvec(3072) <=> ${vectorStr}::halfvec(3072)
      LIMIT ${topK}
    `);

    return (results.rows as unknown as FeedbackVectorRow[])
      .map((row) => ({
        id: row.id,
        feedbackText: row.feedback_text,
        sentiment: row.sentiment,
        tags: row.tags,
        similarity: parseFloat(row.similarity) || 0,
      }))
      .filter((r) => r.similarity >= SIMILARITY_THRESHOLD);
  } catch (error) {
    console.error("[feedback-vector-store] searchSimilarFeedback error:", error);
    return [];
  }
}

// Delete a feedback row entirely from design_feedback.
export async function deleteFeedbackVector(id: string): Promise<void> {
  try {
    await db.execute(
      sql`DELETE FROM design_feedback WHERE id = ${id}`
    );
  } catch (error) {
    console.error("[feedback-vector-store] deleteFeedbackVector error:", error);
    throw error;
  }
}

// Replace the embedding_vector on an existing design_feedback row.
export async function updateFeedbackVector(
  id: string,
  embedding: number[]
): Promise<void> {
  try {
    const vectorStr = `[${embedding.join(",")}]`;
    await db.execute(
      sql`UPDATE design_feedback SET embedding_vector = ${vectorStr}::vector WHERE id = ${id}`
    );
  } catch (error) {
    console.error("[feedback-vector-store] updateFeedbackVector error:", error);
    throw error;
  }
}
