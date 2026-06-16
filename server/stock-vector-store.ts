import { db } from "./db";
import { sql } from "drizzle-orm";

export interface SimilarStockItem {
  id: string;
  jewelCode: string;
  styleNo: string;
  imageUrl: string | null;
  category: string | null;
  tagPrice: number | null;
  status: string;
  similarity: number;
}

export async function searchSimilarStockItems(
  queryEmbedding: number[],
  topK: number = 8,
  filters?: { status?: string; category?: string; excludeIds?: string[] }
): Promise<SimilarStockItem[]> {
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  let whereClause = `embedding_vector IS NOT NULL AND embedding_status = 'done'`;
  if (filters?.status) {
    whereClause += ` AND status = '${filters.status.replace(/'/g, "''")}'`;
  }
  if (filters?.category) {
    whereClause += ` AND category = '${filters.category.replace(/'/g, "''")}'`;
  }
  if (filters?.excludeIds && filters.excludeIds.length > 0) {
    const escaped = filters.excludeIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    whereClause += ` AND id NOT IN (${escaped})`;
  }

  const results = await db.execute(sql.raw(`
    SELECT
      id,
      jewel_code as "jewelCode",
      style_no as "styleNo",
      image_url as "imageUrl",
      category,
      tag_price as "tagPrice",
      status,
      1 - (embedding_vector::vector(3072) <=> '${vectorStr}'::vector(3072)) as similarity
    FROM stock_items
    WHERE ${whereClause}
    ORDER BY embedding_vector::vector(3072) <=> '${vectorStr}'::vector(3072)
    LIMIT ${topK}
  `));

  return (results.rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    jewelCode: row.jewelCode as string,
    styleNo: row.styleNo as string,
    imageUrl: row.imageUrl as string | null,
    category: row.category as string | null,
    tagPrice: row.tagPrice ? Number(row.tagPrice) : null,
    status: row.status as string,
    similarity: parseFloat(String(row.similarity)) || 0,
  }));
}
