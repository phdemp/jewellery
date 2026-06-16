/**
 * Embed stock_items labels using Gemini gemini-embedding-001.
 * Reads items with a label but no embedding_vector, embeds in batches, updates DB.
 *
 * Usage: npx tsx --env-file=.env server/embed-stock-labels.ts
 */

import { GoogleGenAI } from "@google/genai";
import { Pool } from "pg";

const BATCH_SIZE = 20; // Gemini batch limit
const CONCURRENCY = 3; // parallel batch requests
const DELAY_MS = 500; // delay between waves to avoid rate limits

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

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Get items with labels but no embeddings
  const result = await pool.query(
    "SELECT id, label FROM stock_items WHERE label IS NOT NULL AND embedding_vector IS NULL ORDER BY id"
  );
  const items = result.rows as { id: string; label: string }[];
  console.log(`Items to embed: ${items.length}`);

  if (items.length === 0) {
    console.log("Nothing to do.");
    await pool.end();
    return;
  }

  let embedded = 0;
  let errors = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < items.length; i += BATCH_SIZE * CONCURRENCY) {
    const waves: { id: string; label: string }[][] = [];

    for (let w = 0; w < CONCURRENCY; w++) {
      const start = i + w * BATCH_SIZE;
      const batch = items.slice(start, start + BATCH_SIZE);
      if (batch.length > 0) waves.push(batch);
    }

    const waveResults = await Promise.allSettled(
      waves.map(async (batch) => {
        const texts = batch.map((item) => item.label);
        const embeddings = await embedBatch(texts);

        // Update DB for each item in batch
        for (let j = 0; j < batch.length; j++) {
          const vectorStr = `[${embeddings[j].join(",")}]`;
          await pool.query(
            `UPDATE stock_items SET embedding_vector = $1::vector, embedding_status = 'done' WHERE id = $2`,
            [vectorStr, batch[j].id]
          );
        }
        return batch.length;
      })
    );

    for (const result of waveResults) {
      if (result.status === "fulfilled") {
        embedded += result.value;
      } else {
        errors++;
        console.error("Batch error:", result.reason?.message || result.reason);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (embedded / (parseFloat(elapsed) || 1)).toFixed(1);
    const remaining = items.length - embedded - errors * BATCH_SIZE;
    const eta = remaining > 0 ? (remaining / parseFloat(rate || "1") / 60).toFixed(1) : "0";
    console.log(
      `Progress: ${embedded}/${items.length} embedded (${rate}/s, ~${eta}min remaining, ${errors} batch errors) [${elapsed}s]`
    );

    // Rate limit delay between waves
    if (i + BATCH_SIZE * CONCURRENCY < items.length) {
      await sleep(DELAY_MS);
    }
  }

  // Final stats
  const stats = await pool.query(
    "SELECT embedding_status, COUNT(*) as c FROM stock_items GROUP BY embedding_status ORDER BY c DESC"
  );
  console.log("\n=== Embedding Status ===");
  for (const row of stats.rows) {
    console.log(`  ${row.embedding_status || "null"}: ${row.c}`);
  }

  const vecCount = await pool.query(
    "SELECT COUNT(*) as c FROM stock_items WHERE embedding_vector IS NOT NULL"
  );
  console.log(`\nTotal with vectors: ${vecCount.rows[0].c}`);

  console.log(`\nDone: ${embedded} embedded, ${errors} batch errors in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
