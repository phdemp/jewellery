/**
 * Embed live_stock_items and b2b_sales_history for vector-based assortment scoring.
 *
 * Builds a rich text description from metadata for each row, then embeds with
 * Gemini gemini-embedding-001 (3072-dim). No image downloads needed.
 *
 * Usage:
 *   npx tsx --env-file=.env server/embed-assortment-data.ts              # both tables
 *   npx tsx --env-file=.env server/embed-assortment-data.ts --stock      # live stock only
 *   npx tsx --env-file=.env server/embed-assortment-data.ts --sales      # B2B sales only
 */

import { GoogleGenAI } from "@google/genai";
import { Pool } from "pg";

const BATCH_SIZE = 20;
const CONCURRENCY = 3;
const DELAY_MS = 500;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: texts,
  });
  if (!response.embeddings || response.embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${response.embeddings?.length || 0}`);
  }
  return response.embeddings.map((e) => e.values!);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Build rich text for live_stock_items ─────────────────────────────────────

interface StockRow {
  id: string;
  jewel_code: string;
  style_no: string | null;
  category: string | null;
  sub_category: string | null;
  stock_type: string | null;
  base_metal: string | null;
  make_type: string | null;
  tag_price: number | null;
  cost_price: number | null;
  gross_wt: string | null;
  pure_wt: string | null;
  tot_dia_wt: string | null;
  tot_polki_wt: string | null;
  tot_color_stone_wt: string | null;
  collection_name: string | null;
  location: string | null;
  ageing_days: number | null;
}

function buildStockEmbeddingText(row: StockRow): string {
  const parts = [
    row.category && `Category: ${row.category}`,
    row.sub_category && `SubCategory: ${row.sub_category}`,
    row.stock_type && `Type: ${row.stock_type}`,
    row.base_metal && `Metal: ${row.base_metal}`,
    row.make_type && `Make: ${row.make_type}`,
    row.tag_price && `Price: ${row.tag_price}`,
    row.gross_wt && `GrossWt: ${row.gross_wt}g`,
    row.pure_wt && Number(row.pure_wt) > 0 && `PureWt: ${row.pure_wt}g`,
    row.tot_dia_wt && Number(row.tot_dia_wt) > 0 && `DiamondWt: ${row.tot_dia_wt}ct`,
    row.tot_polki_wt && Number(row.tot_polki_wt) > 0 && `PolkiWt: ${row.tot_polki_wt}ct`,
    row.tot_color_stone_wt && Number(row.tot_color_stone_wt) > 0 && `ColorStoneWt: ${row.tot_color_stone_wt}ct`,
    row.collection_name && `Collection: ${row.collection_name}`,
    row.location && `Location: ${row.location}`,
    row.ageing_days != null && `Ageing: ${row.ageing_days} days`,
  ].filter(Boolean);
  return `Jewellery item ${row.jewel_code}: ${parts.join(", ")}`;
}

// ── Build rich text for b2b_sales_history ────────────────────────────────────

interface SalesRow {
  id: string;
  jewel_code: string | null;
  category: string | null;
  category_group: string | null;
  stock_type: string | null;
  sub_category: string | null;
  make_type: string | null;
  base_metal_quality: string | null;
  tag_price: number | null;
  final_price: number | null;
  gross_wt: string | null;
  pure_wt: string | null;
  tot_dia_wt: string | null;
  motif: string | null;
  motif_category: string | null;
  product_segment: string | null;
  design_shape: string | null;
  finish: string | null;
  stone_colour: string | null;
  material_ratio: string | null;
}

function buildSalesEmbeddingText(row: SalesRow): string {
  const parts = [
    row.category && `Category: ${row.category}`,
    row.category_group && `Group: ${row.category_group}`,
    row.stock_type && `Type: ${row.stock_type}`,
    row.sub_category && `Sub: ${row.sub_category}`,
    row.make_type && `Make: ${row.make_type}`,
    row.base_metal_quality && `Metal: ${row.base_metal_quality}`,
    row.tag_price && `TagPrice: ${row.tag_price}`,
    row.final_price && `SoldPrice: ${row.final_price}`,
    row.gross_wt && `GrossWt: ${row.gross_wt}g`,
    row.product_segment && `Segment: ${row.product_segment}`,
    row.motif && `Motif: ${row.motif}`,
    row.motif_category && `MotifCategory: ${row.motif_category}`,
    row.design_shape && `Shape: ${row.design_shape}`,
    row.finish && `Finish: ${row.finish}`,
    row.stone_colour && `StoneColour: ${row.stone_colour}`,
    row.material_ratio && `Material: ${row.material_ratio}`,
  ].filter(Boolean);
  return `Sold jewellery ${row.jewel_code || "unknown"}: ${parts.join(", ")}`;
}

// ── Generic batch processing ────────────────────────────────────────────────

async function processTable(
  pool: Pool,
  tableName: string,
  selectQuery: string,
  buildText: (row: Record<string, unknown>) => string
): Promise<void> {
  const result = await pool.query(selectQuery);
  const items = result.rows;
  console.log(`\n[${tableName}] Items to embed: ${items.length}`);

  if (items.length === 0) {
    console.log(`[${tableName}] Nothing to do.`);
    return;
  }

  let embedded = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < items.length; i += BATCH_SIZE * CONCURRENCY) {
    const waves: Record<string, unknown>[][] = [];

    for (let w = 0; w < CONCURRENCY; w++) {
      const start = i + w * BATCH_SIZE;
      const batch = items.slice(start, start + BATCH_SIZE);
      if (batch.length > 0) waves.push(batch);
    }

    const waveResults = await Promise.allSettled(
      waves.map(async (batch) => {
        const texts = batch.map((item) => buildText(item));
        const embeddings = await embedBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          const vectorStr = `[${embeddings[j].join(",")}]`;
          await pool.query(
            `UPDATE ${tableName} SET embedding_vector = $1::vector, embedding_status = 'done' WHERE id = $2`,
            [vectorStr, batch[j].id]
          );
        }
        return batch.length;
      })
    );

    for (const r of waveResults) {
      if (r.status === "fulfilled") {
        embedded += r.value;
      } else {
        errors++;
        console.error(`[${tableName}] Batch error:`, r.reason?.message || r.reason);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (embedded / (parseFloat(elapsed) || 1)).toFixed(1);
    console.log(
      `[${tableName}] ${embedded}/${items.length} (${rate}/s, ${errors} errors) [${elapsed}s]`
    );

    if (i + BATCH_SIZE * CONCURRENCY < items.length) {
      await sleep(DELAY_MS);
    }
  }

  // Summary
  const stats = await pool.query(
    `SELECT embedding_status, COUNT(*) as c FROM ${tableName} GROUP BY embedding_status ORDER BY c DESC`
  );
  console.log(`\n[${tableName}] Embedding Status:`);
  for (const row of stats.rows) {
    console.log(`  ${row.embedding_status || "null"}: ${row.c}`);
  }
  console.log(`[${tableName}] Done: ${embedded} embedded, ${errors} errors in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doStock = args.length === 0 || args.includes("--stock");
  const doSales = args.length === 0 || args.includes("--sales");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Ensure pgvector extension
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");

  if (doStock) {
    await processTable(
      pool,
      "live_stock_items",
      `SELECT id, jewel_code, style_no, category, sub_category, stock_type,
              base_metal, make_type, tag_price, cost_price, gross_wt, pure_wt,
              tot_dia_wt, tot_polki_wt, tot_color_stone_wt, collection_name,
              location, ageing_days
       FROM live_stock_items
       WHERE (embedding_vector IS NULL OR embedding_status IS NULL OR embedding_status != 'done')
       ORDER BY tag_price DESC NULLS LAST`,
      (row) => buildStockEmbeddingText(row as unknown as StockRow)
    );
  }

  if (doSales) {
    await processTable(
      pool,
      "b2b_sales_history",
      `SELECT id, jewel_code, category, category_group, stock_type, sub_category,
              make_type, base_metal_quality, tag_price, final_price, gross_wt, pure_wt,
              tot_dia_wt, motif, motif_category, product_segment, design_shape,
              finish, stone_colour, material_ratio
       FROM b2b_sales_history
       WHERE (embedding_vector IS NULL OR embedding_status IS NULL OR embedding_status != 'done')
       ORDER BY final_price DESC NULLS LAST`,
      (row) => buildSalesEmbeddingText(row as unknown as SalesRow)
    );
  }

  await pool.end();
  console.log("\nAll done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
