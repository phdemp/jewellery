/**
 * Process remaining 2,778 stock images via Gemini Batch API (vision) + live API (embeddings).
 * Runs in waves of WAVE_SIZE images. Retries failed downloads/embeddings.
 *
 * Run: npx tsx --env-file=.env server/stock-batch-remaining.ts
 */

import { GoogleGenAI, type BatchJob, type Content } from "@google/genai";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";
import * as fs from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { db } from "./db";
import { referenceImages } from "@shared/schema";
import { eq } from "drizzle-orm";

const XLSX_PATH = "stock_with_VA.xlsx";
const SKIP_FIRST = 100; // already done
const WAVE_SIZE = 250; // images per vision batch
const DOWNLOAD_CONCURRENCY = 10;
const EMBED_CONCURRENCY = 5;
const TMP_DIR = "tmp-batch";
const POLL_INTERVAL_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

const COMPLETED_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"]);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface StockRow { [key: string]: unknown; "Jewel Code": string; "Style Code": string; "Image_URL": string; Category: string; Theme: string; }
interface PreparedItem { row: StockRow; localPath: string; thumbnailPath: string; base64: string; dbId: string; analysis?: Record<string, unknown>; embeddingText?: string; embedding?: number[]; }

const VISION_PROMPT = `You are an expert jewellery design analyst. Analyze this jewellery design sketch image and extract detailed style information:
1. description: A detailed description of the design
2. styleElements: List of style elements (line weight, shading technique, rendering style)
3. motifs: Motifs present (nature, geometric, celestial, etc.)
4. structure: Structural elements (symmetry, layout, pendant style, layering)
5. lineStyle: Describe the line quality
6. coloringTechnique: How colors are applied
7. labelStyle: If there are text labels, describe them
8. gemstoneRendering: How gemstones are drawn
9. backgroundStyle: Background description
Respond in JSON format: { "description": string, "styleElements": string[], "motifs": string[], "structure": string, "lineStyle": string, "coloringTechnique": string, "labelStyle": string, "gemstoneRendering": string, "backgroundStyle": string }`;

// Column list for metadata
const META_KEYS = ["Jewel Code","Style Code","Manufacturer","Make Type","Sub Category","Stock Type","Category","Collection Group Name","CollectionName","Base Metal","Location Name","Client Name","Order Customer Name","SalesPerson","MakeDate","Status","Transaction Date","Quantity","ItemPcs","Dia Wt","CS Wt","Pure Wt","Pure Wt (Clarity)","Total Net Wt","Gross Wt","Cost Price","Tag Price","Ageing Days","Ord_SKETCH DESIGNER :","Book","Lab Name","Certificate No","VA_Category","Brand Name","Design Shape","Enamel","Finish","Material Ratio","Motif","Motif category","Piroi Colour","Piroi Placement","Polki Size","Price-band","Product Segment","Set-Cateogry","Stone Colour","Talaf","Theme"];

function buildMeta(row: StockRow): Record<string, unknown> {
  const m: Record<string, unknown> = { source: "stock_with_VA.xlsx" };
  for (const k of META_KEYS) m[k.replace(/[^a-zA-Z0-9]/g, "_")] = row[k] ?? null;
  return m;
}

function extractFileId(url: string): string | null {
  const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function downloadWithRetry(url: string, retries = MAX_RETRIES): Promise<Buffer> {
  const fileId = extractFileId(url);
  if (!fileId) throw new Error(`Bad URL: ${url}`);
  const dlUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(dlUrl, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        const html = await resp.text();
        const cm = html.match(/confirm=([a-zA-Z0-9_-]+)/);
        if (cm) {
          const r2 = await fetch(`https://drive.google.com/uc?export=download&confirm=${cm[1]}&id=${fileId}`, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
          if (!r2.ok) throw new Error(`Confirm HTTP ${r2.status}`);
          return Buffer.from(await r2.arrayBuffer());
        }
        throw new Error("HTML page, not image");
      }
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`    Retry ${attempt}/${retries} for ${fileId}: ${err instanceof Error ? err.message : err}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("unreachable");
}

function buildEmbText(a: Record<string, unknown>): string {
  const d = (a.description as string) ?? "";
  const s = Array.isArray(a.styleElements) ? (a.styleElements as string[]).join(", ") : "";
  const m = Array.isArray(a.motifs) ? (a.motifs as string[]).join(", ") : "";
  const st = (a.structure as string) ?? "";
  return `${d} Style: ${s}. Motifs: ${m}. Structure: ${st}`;
}

async function embedWithRetry(text: string, retries = MAX_RETRIES): Promise<number[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await ai.models.embedContent({ model: "gemini-embedding-001", contents: text });
      if (resp.embeddings?.[0]?.values) return resp.embeddings[0].values;
      throw new Error("No embedding returned");
    } catch (err) {
      if (attempt === retries) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const isThrottle = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
      const delay = isThrottle ? 30_000 * attempt : RETRY_DELAY_MS * attempt;
      console.warn(`    Embed retry ${attempt}/${retries}: ${msg} (waiting ${delay / 1000}s)`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function pollBatch(jobName: string): Promise<BatchJob> {
  let job = await ai.batches.get({ name: jobName });
  const start = Date.now();
  while (!COMPLETED_STATES.has(job.state ?? "")) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`  [${elapsed}s] ${job.state}       \r`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    job = await ai.batches.get({ name: jobName });
  }
  console.log(`  Finished: ${job.state} in ${((Date.now() - start) / 1000).toFixed(0)}s                `);
  return job;
}

// ---- Main ----

async function main() {
  const t0 = Date.now();
  console.log("=== Stock Batch Import — Remaining 2778 ===\n");

  const wb = xlsxRead(await fs.readFile(XLSX_PATH));
  const allRows = xlsxUtils.sheet_to_json<StockRow>(wb.Sheets[wb.SheetNames[0]]);
  const withImages = allRows.filter(r => r.Image_URL?.includes("drive.google.com"));
  const remaining = withImages.slice(SKIP_FIRST);
  console.log(`Remaining images: ${remaining.length}\n`);

  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir("uploads", { recursive: true });

  let totalSuccess = 0, totalFail = 0, totalSkipped = 0;
  const numWaves = Math.ceil(remaining.length / WAVE_SIZE);

  for (let w = 0; w < numWaves; w++) {
    const waveRows = remaining.slice(w * WAVE_SIZE, (w + 1) * WAVE_SIZE);
    const waveNum = w + 1;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`WAVE ${waveNum}/${numWaves} — ${waveRows.length} images (total offset: ${SKIP_FIRST + w * WAVE_SIZE})`);
    console.log("─".repeat(60));

    // -- Download --
    console.log("  Downloading…");
    const prepared: PreparedItem[] = [];
    let dlFail = 0;
    for (let i = 0; i < waveRows.length; i += DOWNLOAD_CONCURRENCY) {
      const chunk = waveRows.slice(i, i + DOWNLOAD_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(async (row): Promise<PreparedItem> => {
        const buf = await downloadWithRetry(row.Image_URL);
        const ts = Date.now();
        const safe = (row["Style Code"] || "unk").replace(/[^a-zA-Z0-9._-]/g, "_");
        const lp = `uploads/${ts}_${safe}.jpg`;
        const jpgBuf = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
        await fs.writeFile(lp, jpgBuf);
        const tp = `uploads/thumb_${ts}_${safe}.jpg`;
        await sharp(buf).resize(300, 300, { fit: "cover", position: "center" }).jpeg({ quality: 80 }).toFile(tp);
        const meta = buildMeta(row);
        const res = await db.insert(referenceImages).values({ id: crypto.randomUUID(), filename: `${row["Style Code"]}.jpg`, filepath: lp, thumbnailPath: tp, themeCode: null, metadata: meta, embedding: null, embeddingVector: null }).returning();
        return { row, localPath: lp, thumbnailPath: tp, base64: jpgBuf.toString("base64"), dbId: res[0].id };
      }));
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === "fulfilled") prepared.push((results[j] as PromiseFulfilledResult<PreparedItem>).value);
        else { dlFail++; console.warn(`    ✗ ${chunk[j]["Style Code"]}: ${(results[j] as PromiseRejectedResult).reason?.message}`); }
      }
      process.stdout.write(`    ${prepared.length}/${waveRows.length} downloaded\r`);
    }
    console.log(`    ${prepared.length} downloaded, ${dlFail} failed              `);

    if (prepared.length === 0) { console.log("  Skipping wave — no images."); totalFail += dlFail; continue; }

    // -- Vision batch --
    console.log("  Submitting vision batch…");
    const jsonlPath = path.join(TMP_DIR, `wave-${waveNum}-${Date.now()}.jsonl`);
    const lines = prepared.map(item => JSON.stringify({
      key: item.dbId,
      request: { contents: [{ parts: [{ inlineData: { data: item.base64, mimeType: "image/jpeg" } }, { text: VISION_PROMPT }] }], generation_config: { responseMimeType: "application/json" } },
    }));
    await fs.writeFile(jsonlPath, lines.join("\n"), "utf-8");
    for (const item of prepared) item.base64 = ""; // free memory

    let visionOk = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const uploaded = await ai.files.upload({ file: jsonlPath, config: { mimeType: "jsonl" as string } });
        const job = await ai.batches.create({ model: "gemini-2.5-flash", src: uploaded.name!, config: { displayName: `stock-w${waveNum}-${Date.now()}` } });
        console.log(`  Vision job: ${job.name}`);
        const done = await pollBatch(job.name!);
        if (done.state !== "JOB_STATE_SUCCEEDED") { throw new Error(`Vision batch state: ${done.state}`); }
        // Parse results
        if (done.dest?.fileName) {
          const rp = path.join(TMP_DIR, `vr-${waveNum}-${Date.now()}.jsonl`);
          await ai.files.download({ file: done.dest.fileName, downloadPath: rp });
          const text = await fs.readFile(rp, "utf-8");
          const imageMap = new Map(prepared.map(p => [p.dbId, p]));
          for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
              const p = JSON.parse(line);
              if (p.error || !p.response) continue;
              const img = p.key ? imageMap.get(p.key) : undefined;
              if (!img) continue;
              const rt = p.response?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (!rt) continue;
              img.analysis = JSON.parse(rt);
              img.embeddingText = buildEmbText(img.analysis!);
            } catch { /* skip */ }
          }
        }
        visionOk = true;
        break;
      } catch (err) {
        console.error(`  Vision attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
        if (attempt < MAX_RETRIES) { console.log(`  Waiting 60s before retry…`); await new Promise(r => setTimeout(r, 60_000)); }
      }
    }
    if (!visionOk) { console.error("  Vision batch failed after retries. Skipping wave."); totalFail += prepared.length; totalSkipped += prepared.length; continue; }

    const analyzed = prepared.filter(p => p.embeddingText);
    console.log(`  Vision: ${analyzed.length}/${prepared.length} analyzed`);

    // -- Live embeddings (fast, with throttle handling) --
    console.log("  Generating embeddings (live API)…");
    let embOk = 0, embFail = 0;
    for (let i = 0; i < analyzed.length; i += EMBED_CONCURRENCY) {
      const chunk = analyzed.slice(i, i + EMBED_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(async (item) => {
        item.embedding = await embedWithRetry(item.embeddingText!);
      }));
      for (const r of results) { if (r.status === "fulfilled") embOk++; else embFail++; }
      process.stdout.write(`    ${embOk}/${analyzed.length} embedded\r`);
    }
    console.log(`    ${embOk} embedded, ${embFail} failed              `);

    // -- DB update --
    console.log("  Updating DB…");
    let dbOk = 0;
    for (const item of prepared) {
      try {
        const merged = { ...buildMeta(item.row), ...(item.analysis ?? {}) };
        await db.update(referenceImages).set({ metadata: merged, embedding: item.embedding ?? null, embeddingVector: item.embedding ?? null }).where(eq(referenceImages.id, item.dbId));
        dbOk++;
      } catch { totalFail++; }
    }
    totalSuccess += dbOk;
    totalFail += (prepared.length - dbOk);
    console.log(`  DB: ${dbOk}/${prepared.length} updated`);
    console.log(`  Running total: ${totalSuccess} success, ${totalFail} failed`);
  }

  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});

  const totalTime = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`FINAL SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Processed:  ${remaining.length}`);
  console.log(`  Success:    ${totalSuccess}`);
  console.log(`  Failed:     ${totalFail}`);
  console.log(`  Skipped:    ${totalSkipped}`);
  console.log(`  Total time: ${totalTime} minutes`);
  console.log(`${"=".repeat(60)}`);
  process.exit(0);
}

main().catch(err => { console.error("\nFATAL:", err); process.exit(1); });
