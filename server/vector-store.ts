import { db } from "./db";
import { referenceImages } from "@shared/schema";
import { sql, eq, and, isNotNull } from "drizzle-orm";

interface SimilarVector {
  id: string;
  metadata: any;
  similarity: number;
}

// Add or update a vector in the database
export async function addVector(id: string, embedding: number[], metadata: any): Promise<void> {
  const vectorStr = `[${embedding.join(",")}]`;
  
  await db
    .update(referenceImages)
    .set({
      embeddingVector: embedding,
      embedding: embedding, // Keep JSON version for backwards compatibility
      metadata: metadata,
    })
    .where(eq(referenceImages.id, id));
}

// Search for similar vectors using pgvector cosine similarity
export async function searchSimilarVectors(
  queryEmbedding: number[],
  topK: number = 3,
  themeCode?: string
): Promise<SimilarVector[]> {
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  
  // Build the query with optional theme filter
  // Using 1 - cosine distance to get similarity (pgvector uses <=> for cosine distance)
  let results;
  
  if (themeCode) {
    results = await db.execute(sql`
      SELECT 
        id,
        metadata,
        1 - (embedding_vector::vector(3072) <=> ${vectorStr}::vector(3072)) as similarity
      FROM reference_images
      WHERE embedding_vector IS NOT NULL
        AND theme_code = ${themeCode}
      ORDER BY embedding_vector::vector(3072) <=> ${vectorStr}::vector(3072)
      LIMIT ${topK}
    `);
  } else {
    results = await db.execute(sql`
      SELECT 
        id,
        metadata,
        1 - (embedding_vector::vector(3072) <=> ${vectorStr}::vector(3072)) as similarity
      FROM reference_images
      WHERE embedding_vector IS NOT NULL
      ORDER BY embedding_vector::vector(3072) <=> ${vectorStr}::vector(3072)
      LIMIT ${topK}
    `);
  }
  
  return (results.rows as any[]).map(row => ({
    id: row.id,
    metadata: row.metadata,
    similarity: parseFloat(row.similarity) || 0,
  }));
}

// Get all vectors (for migration/debugging)
export async function getAllVectors(): Promise<Array<{ id: string; embedding: number[]; metadata: any }>> {
  const results = await db
    .select({
      id: referenceImages.id,
      embedding: referenceImages.embeddingVector,
      metadata: referenceImages.metadata,
    })
    .from(referenceImages)
    .where(isNotNull(referenceImages.embeddingVector));
  
  return results.map(row => ({
    id: row.id,
    embedding: row.embedding || [],
    metadata: row.metadata,
  }));
}

// Delete a vector (sets the embedding to null)
export async function deleteVector(id: string): Promise<void> {
  await db
    .update(referenceImages)
    .set({
      embeddingVector: null,
      embedding: null,
    })
    .where(eq(referenceImages.id, id));
}

// Clear all vectors (for re-embedding)
export async function clearVectorStore(): Promise<void> {
  await db
    .update(referenceImages)
    .set({
      embeddingVector: null,
      embedding: null,
    });
}

// Migrate embeddings from JSON column to pgvector column
export async function migrateJsonToVector(): Promise<number> {
  // Get all reference images that have JSON embedding but no vector embedding
  const images = await db
    .select({
      id: referenceImages.id,
      embedding: referenceImages.embedding,
    })
    .from(referenceImages)
    .where(
      and(
        isNotNull(referenceImages.embedding),
        sql`embedding_vector IS NULL`
      )
    );
  
  let migrated = 0;
  for (const image of images) {
    if (image.embedding && Array.isArray(image.embedding)) {
      const vectorStr = `[${(image.embedding as number[]).join(",")}]`;
      await db.execute(sql`
        UPDATE reference_images 
        SET embedding_vector = ${vectorStr}::vector
        WHERE id = ${image.id}
      `);
      migrated++;
    }
  }
  
  return migrated;
}
