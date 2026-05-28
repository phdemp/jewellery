import { GoogleGenAI, type BatchJob, type Content } from "@google/genai";
import * as fs from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { storage } from "./storage";
import { db } from "./db";
import { referenceImages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { downloadImage, listImagesInFolder, extractFolderId, type DriveFile } from "./google-drive";

// ---------------------------------------------------------------------------
// Gemini client (lazy, same pattern as google-client.ts)
// ---------------------------------------------------------------------------

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return _ai;
}

// ---------------------------------------------------------------------------
// Batch Import State
// ---------------------------------------------------------------------------

export interface BatchImportState {
  status: "idle" | "downloading" | "vision_batch" | "embedding_batch" | "finalizing" | "completed" | "failed";
  totalImages: number;
  downloadedCount: number;
  analyzedCount: number;
  embeddedCount: number;
  successCount: number;
  failCount: number;
  error?: string;
  visionJobName?: string;
  embeddingJobName?: string;
  startedAt?: string;
  completedAt?: string;
  results: { filename: string; success: boolean; error?: string }[];
}

let batchState: BatchImportState = { status: "idle", totalImages: 0, downloadedCount: 0, analyzedCount: 0, embeddedCount: 0, successCount: 0, failCount: 0, results: [] };

export function getBatchImportStatus(): BatchImportState {
  return { ...batchState };
}

function resetState(): void {
  batchState = { status: "idle", totalImages: 0, downloadedCount: 0, analyzedCount: 0, embeddedCount: 0, successCount: 0, failCount: 0, results: [] };
}

// ---------------------------------------------------------------------------
// Prepared image record — tracks each image through the pipeline
// ---------------------------------------------------------------------------

interface PreparedImage {
  driveFile: DriveFile;
  localPath: string;
  thumbnailPath: string;
  base64: string;
  dbId: string;
  themeCode: string;
  analysis?: Record<string, unknown>;
  embeddingText?: string;
  embedding?: number[];
}

// ---------------------------------------------------------------------------
// Vision analysis prompt (same as google-client.ts analyzeReferenceImage)
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
// Constants
// ---------------------------------------------------------------------------

const COMPLETED_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"]);
const POLL_INTERVAL_MS = 15_000;
const DOWNLOAD_CONCURRENCY = 5;
const TMP_DIR = "tmp-batch";

// ---------------------------------------------------------------------------
// Main entry: start a batch import from Google Drive
// ---------------------------------------------------------------------------

export async function startBatchImport(folderUrl: string, themeCode: string): Promise<{ started: boolean; error?: string }> {
  if (batchState.status !== "idle" && batchState.status !== "completed" && batchState.status !== "failed") {
    return { started: false, error: `Batch import already in progress (status: ${batchState.status})` };
  }

  resetState();
  batchState.startedAt = new Date().toISOString();

  runBatchPipeline(folderUrl, themeCode).catch((err) => {
    console.error("[batch-import] Pipeline crashed:", err);
    batchState.status = "failed";
    batchState.error = err instanceof Error ? err.message : String(err);
  });

  return { started: true };
}

// ---------------------------------------------------------------------------
// Main entry: batch reembed all existing reference images
// ---------------------------------------------------------------------------

export async function startBatchReembed(): Promise<{ started: boolean; error?: string }> {
  if (batchState.status !== "idle" && batchState.status !== "completed" && batchState.status !== "failed") {
    return { started: false, error: `Batch import already in progress (status: ${batchState.status})` };
  }

  resetState();
  batchState.startedAt = new Date().toISOString();

  runBatchReembedPipeline().catch((err) => {
    console.error("[batch-reembed] Pipeline crashed:", err);
    batchState.status = "failed";
    batchState.error = err instanceof Error ? err.message : String(err);
  });

  return { started: true };
}

// ---------------------------------------------------------------------------
// Pipeline: Drive Import
// ---------------------------------------------------------------------------

async function runBatchPipeline(folderUrl: string, themeCode: string): Promise<void> {
  const ai = getAI();

  // Phase 1: Download images from Drive
  batchState.status = "downloading";
  const folderId = extractFolderId(folderUrl);
  const driveFiles = await listImagesInFolder(folderId);
  if (driveFiles.length === 0) {
    batchState.status = "failed";
    batchState.error = "No images found in the folder";
    return;
  }
  batchState.totalImages = driveFiles.length;

  await fs.mkdir(TMP_DIR, { recursive: true });

  const prepared: PreparedImage[] = [];
  for (let i = 0; i < driveFiles.length; i += DOWNLOAD_CONCURRENCY) {
    const chunk = driveFiles.slice(i, i + DOWNLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((file) => downloadAndSave(file, themeCode))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        prepared.push(r.value);
        batchState.downloadedCount++;
      } else {
        batchState.failCount++;
        batchState.results.push({ filename: chunk[j].name, success: false, error: r.reason?.message ?? String(r.reason) });
      }
    }
  }

  if (prepared.length === 0) {
    batchState.status = "failed";
    batchState.error = "All image downloads failed";
    return;
  }

  await runAnalysisAndEmbeddingPhases(ai, prepared);
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Pipeline: Reembed existing images
// ---------------------------------------------------------------------------

async function runBatchReembedPipeline(): Promise<void> {
  const ai = getAI();
  const images = await storage.getAllReferenceImages();
  if (images.length === 0) {
    batchState.status = "completed";
    batchState.completedAt = new Date().toISOString();
    return;
  }

  batchState.status = "downloading";
  batchState.totalImages = images.length;

  await fs.mkdir(TMP_DIR, { recursive: true });

  const prepared: PreparedImage[] = [];
  for (const img of images) {
    try {
      const buf = await fs.readFile(img.filepath);
      const base64 = buf.toString("base64");
      prepared.push({
        driveFile: { id: img.id, name: img.filename, mimeType: "image/jpeg" },
        localPath: img.filepath,
        thumbnailPath: img.thumbnailPath ?? "",
        base64,
        dbId: img.id,
        themeCode: img.themeCode ?? (img.metadata as Record<string, string>)?.themeCode ?? "",
      });
      batchState.downloadedCount++;
    } catch (err) {
      batchState.failCount++;
      batchState.results.push({ filename: img.filename, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (prepared.length === 0) {
    batchState.status = "failed";
    batchState.error = "Could not read any image files";
    return;
  }

  await runAnalysisAndEmbeddingPhases(ai, prepared);
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Shared: Phase 2 (vision) + Phase 3 (embedding) + finalize
// ---------------------------------------------------------------------------

async function runAnalysisAndEmbeddingPhases(ai: GoogleGenAI, prepared: PreparedImage[]): Promise<void> {
  // ---- Phase 2: Vision analysis batch -----------------------------------
  batchState.status = "vision_batch";
  const jsonlPath = path.join(TMP_DIR, `vision-${Date.now()}.jsonl`);
  await generateVisionJSONL(prepared, jsonlPath);

  console.log(`[batch-import] Uploading vision JSONL (${prepared.length} requests)…`);
  const uploadedFile = await ai.files.upload({
    file: jsonlPath,
    config: { mimeType: "jsonl" as string },
  });
  console.log(`[batch-import] Uploaded: ${uploadedFile.name}`);

  const visionJob = await ai.batches.create({
    model: "gemini-2.5-flash",
    src: uploadedFile.name!,
    config: { displayName: `ref-vision-${Date.now()}` },
  });
  batchState.visionJobName = visionJob.name ?? undefined;
  console.log(`[batch-import] Vision batch submitted: ${visionJob.name}`);

  const completedVisionJob = await pollBatchJob(ai, visionJob.name!);
  if (completedVisionJob.state !== "JOB_STATE_SUCCEEDED") {
    batchState.status = "failed";
    batchState.error = `Vision batch failed: ${completedVisionJob.state}`;
    return;
  }

  await processVisionResults(ai, completedVisionJob, prepared);
  batchState.analyzedCount = prepared.filter((p) => p.analysis).length;
  console.log(`[batch-import] Vision analysis complete: ${batchState.analyzedCount}/${prepared.length}`);

  // ---- Phase 3: Embedding batch ------------------------------------------
  batchState.status = "embedding_batch";
  const embeddableImages = prepared.filter((p) => p.embeddingText);
  if (embeddableImages.length === 0) {
    batchState.status = "failed";
    batchState.error = "No images produced analysis text for embedding";
    return;
  }

  // Build content array for batch embedding: each Content = one embedding request
  const embeddingContents: Content[] = embeddableImages.map((img) => ({
    role: "user",
    parts: [{ text: img.embeddingText! }],
  }));

  console.log(`[batch-import] Submitting embedding batch (${embeddingContents.length} requests)…`);
  const embeddingJob = await ai.batches.createEmbeddings({
    model: "gemini-embedding-001",
    src: { inlinedRequests: { contents: embeddingContents } },
    config: { displayName: `ref-embed-${Date.now()}` },
  });
  batchState.embeddingJobName = embeddingJob.name ?? undefined;
  console.log(`[batch-import] Embedding batch submitted: ${embeddingJob.name}`);

  const completedEmbeddingJob = await pollBatchJob(ai, embeddingJob.name!);
  if (completedEmbeddingJob.state !== "JOB_STATE_SUCCEEDED") {
    batchState.status = "failed";
    batchState.error = `Embedding batch failed: ${completedEmbeddingJob.state}`;
    return;
  }

  processEmbeddingResults(completedEmbeddingJob, embeddableImages);
  batchState.embeddedCount = embeddableImages.filter((p) => p.embedding).length;
  console.log(`[batch-import] Embeddings complete: ${batchState.embeddedCount}/${embeddableImages.length}`);

  // ---- Phase 4: Update DB with analysis + embeddings ----------------------
  batchState.status = "finalizing";
  for (const img of prepared) {
    try {
      if (!img.analysis && !img.embedding) {
        batchState.failCount++;
        batchState.results.push({ filename: img.driveFile.name, success: false, error: "No analysis or embedding produced" });
        continue;
      }

      const metadata = { ...(img.analysis ?? {}), themeCode: img.themeCode };

      await db
        .update(referenceImages)
        .set({
          metadata,
          embedding: img.embedding ?? null,
          embeddingVector: img.embedding ?? null,
        })
        .where(eq(referenceImages.id, img.dbId));

      batchState.successCount++;
      batchState.results.push({ filename: img.driveFile.name, success: true });
    } catch (err) {
      batchState.failCount++;
      batchState.results.push({ filename: img.driveFile.name, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  batchState.status = "completed";
  batchState.completedAt = new Date().toISOString();
  console.log(`[batch-import] Complete — success: ${batchState.successCount}, failed: ${batchState.failCount}`);
}

// ---------------------------------------------------------------------------
// Download a single Drive image, save to disk, create thumbnail + DB record
// ---------------------------------------------------------------------------

async function downloadAndSave(file: DriveFile, themeCode: string): Promise<PreparedImage> {
  const imageBuffer = await downloadImage(file.id);
  const base64 = imageBuffer.toString("base64");

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = `uploads/${timestamp}_${safeName}`;
  await fs.writeFile(localPath, imageBuffer);

  const thumbnailFilename = `thumb_${timestamp}_${safeName.replace(/\.[^.]+$/, "")}.jpg`;
  const thumbnailPath = path.join("uploads", thumbnailFilename);
  await sharp(imageBuffer)
    .resize(300, 300, { fit: "cover", position: "center" })
    .jpeg({ quality: 80 })
    .toFile(thumbnailPath);

  const refImage = await storage.createReferenceImage({
    filename: file.name,
    filepath: localPath,
    thumbnailPath,
    metadata: {},
    embedding: null,
    themeCode,
  });

  return {
    driveFile: file,
    localPath,
    thumbnailPath,
    base64,
    dbId: refImage.id,
    themeCode,
  };
}

// ---------------------------------------------------------------------------
// Generate JSONL for vision analysis batch
// ---------------------------------------------------------------------------

async function generateVisionJSONL(images: PreparedImage[], outputPath: string): Promise<void> {
  const lines: string[] = [];
  for (const img of images) {
    const request = {
      key: img.dbId,
      request: {
        contents: [
          {
            parts: [
              { inlineData: { data: img.base64, mimeType: "image/jpeg" } },
              { text: VISION_PROMPT },
            ],
          },
        ],
        generation_config: { responseMimeType: "application/json" },
      },
    };
    lines.push(JSON.stringify(request));
  }
  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");

  // Free base64 data from memory after writing to disk
  for (const img of images) {
    img.base64 = "";
  }
  console.log(`[batch-import] Wrote vision JSONL: ${lines.length} lines → ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Poll a batch job until it reaches a terminal state
// ---------------------------------------------------------------------------

async function pollBatchJob(ai: GoogleGenAI, jobName: string): Promise<BatchJob> {
  let job = await ai.batches.get({ name: jobName });
  while (!COMPLETED_STATES.has(job.state ?? "")) {
    console.log(`[batch-import] Polling ${jobName} — state: ${job.state}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    job = await ai.batches.get({ name: jobName });
  }
  console.log(`[batch-import] Job ${jobName} finished: ${job.state}`);
  return job;
}

// ---------------------------------------------------------------------------
// Process vision batch results — file-based JSONL output
// ---------------------------------------------------------------------------

interface VisionJSONLLine {
  key?: string;
  response?: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  error?: unknown;
}

async function processVisionResults(ai: GoogleGenAI, job: BatchJob, images: PreparedImage[]): Promise<void> {
  const imageMap = new Map(images.map((img) => [img.dbId, img]));

  // File-based output (from JSONL src)
  if (job.dest?.fileName) {
    const tmpResultPath = path.join(TMP_DIR, `vision-result-${Date.now()}.jsonl`);
    await ai.files.download({ file: job.dest.fileName, downloadPath: tmpResultPath });
    const text = await fs.readFile(tmpResultPath, "utf-8");

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: VisionJSONLLine = JSON.parse(line);
        if (parsed.error || !parsed.response) continue;

        const img = parsed.key ? imageMap.get(parsed.key) : undefined;
        if (!img) continue;

        const responseText = parsed.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) continue;

        const analysis = JSON.parse(responseText) as Record<string, unknown>;
        img.analysis = analysis;
        img.embeddingText = buildEmbeddingText(analysis);
      } catch {
        // skip malformed lines
      }
    }
    return;
  }

  // Inline results (from inline src — not used for vision but handle for safety)
  if (job.dest?.inlinedResponses) {
    for (let i = 0; i < job.dest.inlinedResponses.length && i < images.length; i++) {
      const resp = job.dest.inlinedResponses[i];
      if (resp.error || !resp.response) continue;
      try {
        const responseText = resp.response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) continue;
        const analysis = JSON.parse(responseText) as Record<string, unknown>;
        images[i].analysis = analysis;
        images[i].embeddingText = buildEmbeddingText(analysis);
      } catch {
        // skip
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Process embedding batch results — inline responses
// ---------------------------------------------------------------------------

function processEmbeddingResults(job: BatchJob, images: PreparedImage[]): void {
  // Inline embedding responses (from inlinedRequests src)
  if (job.dest?.inlinedEmbedContentResponses) {
    const responses = job.dest.inlinedEmbedContentResponses;
    for (let i = 0; i < responses.length && i < images.length; i++) {
      const resp = responses[i];
      if (resp.error || !resp.response) continue;
      const values = resp.response.embedding?.values;
      if (values && values.length > 0) {
        images[i].embedding = values;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Build text for embedding from vision analysis (same logic as google-client.ts)
// ---------------------------------------------------------------------------

function buildEmbeddingText(analysis: Record<string, unknown>): string {
  const desc = (analysis.description as string) ?? "";
  const style = Array.isArray(analysis.styleElements) ? (analysis.styleElements as string[]).join(", ") : "";
  const motifs = Array.isArray(analysis.motifs) ? (analysis.motifs as string[]).join(", ") : "";
  const structure = (analysis.structure as string) ?? "";
  return `${desc} Style: ${style}. Motifs: ${motifs}. Structure: ${structure}`;
}
