/**
 * Stock Batch Import Test
 *
 * Reads stock_with_VA.xlsx, downloads first 100 images from Google Drive,
 * then runs Gemini Batch API for vision analysis + embeddings.
 * Stores all xlsx metadata alongside AI analysis in reference_images.
 *
 * Run: npx tsx --env-file=.env server/stock-batch-test.ts
 */

import { GoogleGenAI, type BatchJob, type Content } from "@google/genai";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";
import * as fs from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { db } from "./db";
import { referenceImages } from "@shared/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const XLSX_PATH = "stock_with_VA.xlsx";
const MAX_IMAGES = 100;
const DOWNLOAD_CONCURRENCY = 10;
const TMP_DIR = "tmp-batch";
const POLL_INTERVAL_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const COMPLETED_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"]);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StockRow {
  "Jewel Code": string;
  "Style Code": string;
  "Image_URL": string;
  "Manufacturer": string;
  "Make Type": string;
  "Sub Category": string;
  "Stock Type": string;
  "Category": string;
  "Collection Group Name": string;
  "CollectionName": string;
  "Base Metal": string;
  "Location Name": string;
  "Client Name": string;
  "Order Customer Name": string;
  "SalesPerson": string;
  "MakeDate": string;
  "Status": string;
  "Transaction Date": string;
  "Quantity": number;
  "ItemPcs": number;
  "Dia Wt": number;
  "CS Wt": number;
  "Pure Wt": number;
  "Pure Wt (Clarity)": number;
  "Total Net Wt": number;
  "Gross Wt": number;
  "Cost Price": number;
  "Tag Price": number;
  "Ageing Days": number;
  "Ord_SKETCH DESIGNER :": string;
  "Book": string;
  "Lab Name": string;
  "Certificate No": string;
  "VA_Category": string;
  "Brand Name": string;
  "Design Shape": string;
  "Enamel": string;
  "Finish": string;
  "Material Ratio": string;
  "Motif": string;
  "Motif category": string;
  "Piroi Colour": string;
  "Piroi Placement": string;
  "Polki Size": string;
  "Price-band": string;
  "Product Segment": string;
  "Set-Cateogry": string;
  "Stone Colour": string;
  "Talaf": string;
  "Theme": string;
}

interface PreparedItem {
  row: StockRow;
  localPath: string;
  thumbnailPath: string;
  base64: string;
  dbId: string;
  analysis?: Record<string, unknown>;
  embeddingText?: string;
  embedding?: number[];
}

// ---------------------------------------------------------------------------
// Vision prompt
// ---------------------------------------------------------------------------

const VISION_PROMPT = `You are an expert jewellery design analyst. Analyze this jewellery design sketch image and extract detailed style information:

1. description: A detailed description of the design
2. styleElements: List of style elements (line weight, shading technique, rendering style)
3. motifs: Motifs present (nature, geometric, celestial, etc.)
4. structure: Structural elements (symmetry, layout, pendant style, layering)
5. lineStyle: Describe the line quality (e.g., "fine pencil lines in soft brown", "thin gold-toned outlines", "delicate hand-drawn strokes")
6. coloringTechnique: How colors are applied (e.g., "soft watercolor washes", "light colored pencil shading", "pastel fills")
7. labelStyle: If there are text labels, describe them (e.g., "cursive brown handwriting with thin pointing lines", "none")
8. gemstoneRendering: How gemstones are drawn (e.g., "polki as irregular white shapes with subtle facets", "rubies as soft pink ovals")
9. backgroundStyle: Background description (e.g., "pure white paper", "aged cream/beige paper", "vintage textured")

Respond in JSON format: { "description": string, "styleElements": string[], "motifs": string[], "structure": string, "lineStyle": string, "coloringTechnique": string, "labelStyle": string, "gemstoneRendering": string, "backgroundStyle": string }`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDriveFileId(url: string): string | null {
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function downloadFromDrive(url: string): Promise<Buffer> {
  const fileId = extractDriveFileId(url);
  if (!fileId) throw new Error(`Cannot extract file ID from: ${url}`);

  // Use direct download URL
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const resp = await fetch(downloadUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!resp.ok) throw new Error(`Download failed (${resp.status}): ${downloadUrl}`);

  const contentType = resp.headers.get("content-type") || "";

  // Google may serve an HTML confirmation page for large files
  if (contentType.includes("text/html")) {
    const html = await resp.text();
    // Try to extract confirm token
    const confirmMatch = html.match(/confirm=([a-zA-Z0-9_-]+)/);
    if (confirmMatch) {
      const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
      const resp2 = await fetch(confirmUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!resp2.ok) throw new Error(`Confirmed download failed (${resp2.status})`);
      return Buffer.from(await resp2.arrayBuffer());
    }
    throw new Error("Got HTML instead of image — file may not be publicly accessible");
  }

  return Buffer.from(await resp.arrayBuffer());
}

function buildStockMetadata(row: StockRow): Record<string, unknown> {
  return {
    jewelCode: row["Jewel Code"],
    styleCode: row["Style Code"],
    manufacturer: row["Manufacturer"],
    makeType: row["Make Type"],
    subCategory: row["Sub Category"],
    stockType: row["Stock Type"],
    category: row["Category"],
    collectionGroupName: row["Collection Group Name"],
    collectionName: row["CollectionName"],
    baseMetal: row["Base Metal"],
    locationName: row["Location Name"],
    clientName: row["Client Name"],
    orderCustomerName: row["Order Customer Name"],
    salesPerson: row["SalesPerson"],
    makeDate: row["MakeDate"],
    status: row["Status"],
    transactionDate: row["Transaction Date"],
    quantity: row["Quantity"],
    itemPcs: row["ItemPcs"],
    diaWt: row["Dia Wt"],
    csWt: row["CS Wt"],
    pureWt: row["Pure Wt"],
    pureWtClarity: row["Pure Wt (Clarity)"],
    totalNetWt: row["Total Net Wt"],
    grossWt: row["Gross Wt"],
    costPrice: row["Cost Price"],
    tagPrice: row["Tag Price"],
    ageingDays: row["Ageing Days"],
    sketchDesigner: row["Ord_SKETCH DESIGNER :"],
    book: row["Book"],
    labName: row["Lab Name"],
    certificateNo: row["Certificate No"],
    vaCategory: row["VA_Category"],
    brandName: row["Brand Name"],
    designShape: row["Design Shape"],
    enamel: row["Enamel"],
    finish: row["Finish"],
    materialRatio: row["Material Ratio"],
    motif: row["Motif"],
    motifCategory: row["Motif category"],
    piroiColour: row["Piroi Colour"],
    piroiPlacement: row["Piroi Placement"],
    polkiSize: row["Polki Size"],
    priceBand: row["Price-band"],
    productSegment: row["Product Segment"],
    setCategory: row["Set-Cateogry"],
    stoneColour: row["Stone Colour"],
    talaf: row["Talaf"],
    theme: row["Theme"],
    source: "stock_with_VA.xlsx",
  };
}

function buildEmbeddingText(analysis: Record<string, unknown>): string {
  const desc = (analysis.description as string) ?? "";
  const style = Array.isArray(analysis.styleElements) ? (analysis.styleElements as string[]).join(", ") : "";
  const motifs = Array.isArray(analysis.motifs) ? (analysis.motifs as string[]).join(", ") : "";
  const structure = (analysis.structure as string) ?? "";
  return `${desc} Style: ${style}. Motifs: ${motifs}. Structure: ${structure}`;
}

function mapThemeCode(theme: string | undefined): string {
  if (!theme) return "";
  const map: Record<string, string> = {
    "Affordable Luxury": "WRD",
    "Contemporary minimal": "WRO",
    "Collectable Occasional": "CLO",
    "Solitaire Daily": "SOD",
    "Solitaire Occasional": "SOO",
    "Solitaire Premium": "SOP",
    "Bridal Classic": "BRC",
    "Bridal Premium": "BRP",
    "Bridal Unique": "BRU",
  };
  return map[theme] ?? "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log("=== Stock Batch Import Test ===\n");

  // 1. Read xlsx
  console.log("[1/7] Reading xlsx…");
  const wb = xlsxRead(await fs.readFile(XLSX_PATH));
  const rows = xlsxUtils.sheet_to_json<StockRow>(wb.Sheets[wb.SheetNames[0]]);
  const withImages = rows.filter((r) => r.Image_URL?.includes("drive.google.com"));
  const selected = withImages.slice(0, MAX_IMAGES);
  console.log(`  Total rows: ${rows.length}, with images: ${withImages.length}, selected: ${selected.length}\n`);

  // 2. Download images
  console.log("[2/7] Downloading images from Google Drive…");
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir("uploads", { recursive: true });

  const prepared: PreparedItem[] = [];
  let downloadFails = 0;
  const dlStart = Date.now();

  for (let i = 0; i < selected.length; i += DOWNLOAD_CONCURRENCY) {
    const chunk = selected.slice(i, i + DOWNLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (row): Promise<PreparedItem> => {
        const imageBuffer = await downloadFromDrive(row.Image_URL);

        const timestamp = Date.now();
        const safeName = (row["Style Code"] || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
        const localPath = `uploads/${timestamp}_${safeName}.jpg`;

        // Convert to JPEG and save
        const jpegBuffer = await sharp(imageBuffer)
          .jpeg({ quality: 90 })
          .toBuffer();
        await fs.writeFile(localPath, jpegBuffer);

        const thumbnailPath = `uploads/thumb_${timestamp}_${safeName}.jpg`;
        await sharp(imageBuffer)
          .resize(300, 300, { fit: "cover", position: "center" })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);

        const base64 = jpegBuffer.toString("base64");

        // Create DB record with all xlsx metadata
        const stockMeta = buildStockMetadata(row);
        const themeCode = mapThemeCode(row.Theme);

        const result = await db
          .insert(referenceImages)
          .values({
            id: crypto.randomUUID(),
            filename: `${row["Style Code"]}.jpg`,
            filepath: localPath,
            thumbnailPath,
            themeCode: themeCode || null,
            metadata: stockMeta,
            embedding: null,
            embeddingVector: null,
          })
          .returning();

        return {
          row,
          localPath,
          thumbnailPath,
          base64,
          dbId: result[0].id,
        };
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        prepared.push(r.value);
      } else {
        downloadFails++;
        console.warn(`  ✗ ${chunk[j]["Style Code"]}: ${r.reason?.message ?? r.reason}`);
      }
    }
    process.stdout.write(`  Downloaded: ${prepared.length}/${selected.length} (${downloadFails} failed)\r`);
  }

  const dlTime = ((Date.now() - dlStart) / 1000).toFixed(1);
  console.log(`\n  Download complete: ${prepared.length} ok, ${downloadFails} failed in ${dlTime}s\n`);

  if (prepared.length === 0) {
    console.error("No images downloaded. Exiting.");
    process.exit(1);
  }

  // 3. Generate vision JSONL
  console.log("[3/7] Generating vision analysis JSONL…");
  const jsonlPath = path.join(TMP_DIR, `stock-vision-${Date.now()}.jsonl`);
  const lines: string[] = [];
  for (const item of prepared) {
    lines.push(JSON.stringify({
      key: item.dbId,
      request: {
        contents: [{
          parts: [
            { inlineData: { data: item.base64, mimeType: "image/jpeg" } },
            { text: VISION_PROMPT },
          ],
        }],
        generation_config: { responseMimeType: "application/json" },
      },
    }));
  }
  await fs.writeFile(jsonlPath, lines.join("\n"), "utf-8");
  const jsonlSize = (await fs.stat(jsonlPath)).size;
  console.log(`  JSONL: ${lines.length} requests, ${(jsonlSize / 1024 / 1024).toFixed(1)} MB\n`);

  // Free base64 from memory
  for (const item of prepared) item.base64 = "";

  // 4. Upload JSONL + submit vision batch
  console.log("[4/7] Uploading JSONL and submitting vision batch (gemini-2.5-flash)…");
  const visionStart = Date.now();

  const uploadedFile = await ai.files.upload({
    file: jsonlPath,
    config: { mimeType: "jsonl" as string },
  });
  console.log(`  File uploaded: ${uploadedFile.name}`);

  const visionJob = await ai.batches.create({
    model: "gemini-2.5-flash",
    src: uploadedFile.name!,
    config: { displayName: `stock-vision-test-${Date.now()}` },
  });
  console.log(`  Vision batch job: ${visionJob.name}`);
  console.log(`  State: ${visionJob.state}\n`);

  // Poll vision batch
  console.log("[5/7] Polling vision batch…");
  let vJob = await ai.batches.get({ name: visionJob.name! });
  let pollCount = 0;
  while (!COMPLETED_STATES.has(vJob.state ?? "")) {
    pollCount++;
    const elapsed = ((Date.now() - visionStart) / 1000).toFixed(0);
    process.stdout.write(`  [${elapsed}s] Poll #${pollCount}: ${vJob.state}                    \r`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    vJob = await ai.batches.get({ name: visionJob.name! });
  }

  const visionTime = ((Date.now() - visionStart) / 1000).toFixed(1);
  console.log(`\n  Vision batch finished: ${vJob.state} in ${visionTime}s`);

  if (vJob.state !== "JOB_STATE_SUCCEEDED") {
    console.error(`  Vision batch FAILED: ${JSON.stringify(vJob.error)}`);
    process.exit(1);
  }

  // Parse vision results
  const imageMap = new Map(prepared.map((p) => [p.dbId, p]));
  let analysisCount = 0;

  if (vJob.dest?.fileName) {
    const resultPath = path.join(TMP_DIR, `vision-result-${Date.now()}.jsonl`);
    await ai.files.download({ file: vJob.dest.fileName, downloadPath: resultPath });
    const resultText = await fs.readFile(resultPath, "utf-8");

    for (const line of resultText.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.error || !parsed.response) continue;
        const img = parsed.key ? imageMap.get(parsed.key) : undefined;
        if (!img) continue;
        const respText = parsed.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!respText) continue;
        img.analysis = JSON.parse(respText);
        img.embeddingText = buildEmbeddingText(img.analysis!);
        analysisCount++;
      } catch { /* skip */ }
    }
  }
  console.log(`  Parsed ${analysisCount}/${prepared.length} vision results\n`);

  // 5. Submit embedding batch
  const embeddable = prepared.filter((p) => p.embeddingText);
  console.log(`[6/7] Submitting embedding batch (gemini-embedding-001) for ${embeddable.length} items…`);
  const embStart = Date.now();

  const embeddingContents: Content[] = embeddable.map((img) => ({
    role: "user",
    parts: [{ text: img.embeddingText! }],
  }));

  const embJob = await ai.batches.createEmbeddings({
    model: "gemini-embedding-001",
    src: { inlinedRequests: { contents: embeddingContents } },
    config: { displayName: `stock-embed-test-${Date.now()}` },
  });
  console.log(`  Embedding batch job: ${embJob.name}`);

  // Poll embedding batch
  let eJob = await ai.batches.get({ name: embJob.name! });
  pollCount = 0;
  while (!COMPLETED_STATES.has(eJob.state ?? "")) {
    pollCount++;
    const elapsed = ((Date.now() - embStart) / 1000).toFixed(0);
    process.stdout.write(`  [${elapsed}s] Poll #${pollCount}: ${eJob.state}                    \r`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    eJob = await ai.batches.get({ name: embJob.name! });
  }

  const embTime = ((Date.now() - embStart) / 1000).toFixed(1);
  console.log(`\n  Embedding batch finished: ${eJob.state} in ${embTime}s`);

  if (eJob.state !== "JOB_STATE_SUCCEEDED") {
    console.error(`  Embedding batch FAILED: ${JSON.stringify(eJob.error)}`);
    process.exit(1);
  }

  // Parse embedding results
  let embedCount = 0;
  if (eJob.dest?.inlinedEmbedContentResponses) {
    const responses = eJob.dest.inlinedEmbedContentResponses;
    for (let i = 0; i < responses.length && i < embeddable.length; i++) {
      const resp = responses[i];
      if (resp.error || !resp.response) continue;
      const values = resp.response.embedding?.values;
      if (values && values.length > 0) {
        embeddable[i].embedding = values;
        embedCount++;
      }
    }
  }
  console.log(`  Parsed ${embedCount}/${embeddable.length} embeddings (${embeddable[0]?.embedding?.length ?? 0}-dim)\n`);

  // 6. Update DB
  console.log("[7/7] Updating database with analysis + embeddings…");
  let dbSuccess = 0;
  let dbFail = 0;

  for (const item of prepared) {
    try {
      const stockMeta = buildStockMetadata(item.row);
      const mergedMetadata = {
        ...stockMeta,
        ...(item.analysis ?? {}),
      };

      await db
        .update(referenceImages)
        .set({
          metadata: mergedMetadata,
          embedding: item.embedding ?? null,
          embeddingVector: item.embedding ?? null,
        })
        .where(eq(referenceImages.id, item.dbId));

      dbSuccess++;
    } catch (err) {
      dbFail++;
      console.warn(`  ✗ DB update failed for ${item.row["Style Code"]}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Cleanup
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log("BATCH IMPORT SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Total images selected:  ${selected.length}`);
  console.log(`  Downloaded:             ${prepared.length} (${downloadFails} failed)`);
  console.log(`  Vision analysis:        ${analysisCount} succeeded`);
  console.log(`  Embeddings:             ${embedCount} succeeded`);
  console.log(`  DB updates:             ${dbSuccess} ok, ${dbFail} failed`);
  console.log(`  -`);
  console.log(`  Download time:          ${dlTime}s`);
  console.log(`  Vision batch time:      ${visionTime}s`);
  console.log(`  Embedding batch time:   ${embTime}s`);
  console.log(`  Total time:             ${totalTime}s`);
  console.log(`  -`);
  console.log(`  THROTTLING:             ${vJob.state === "JOB_STATE_SUCCEEDED" ? "NO — batch completed without throttling" : "POSSIBLE — check errors"}`);
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
