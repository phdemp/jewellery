// server/prompt-optimizer.ts
// Prompt optimization using AxGEPA evolutionary search.
// AxGEPA optimizes an AxGen program's instruction by running examples through it,
// scoring outputs with a metric function, and evolving better instructions across trials.
// The metric function generates jewellery images and evaluates them with a Vision judge.

import { AxAI, AxGen, AxGEPA, AxAIGoogleGeminiModel } from "@ax-llm/ax";
import type { AxMetricFn } from "@ax-llm/ax";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { evaluateDesignQuality } from "./evaluator";
import { generateJewellerySketch } from "./google-client";
import {
  getActivePrompt,
  activatePromptVersion,
  type PromptScope,
} from "./prompt-registry";

interface DimensionAvg {
  dimension: string;
  avg: number;
}

interface OptimizationResult {
  runId: string;
  scope: PromptScope;
  beforeScore: number;
  afterScore: number;
  improved: boolean;
  newVersionId: string | null;
  weakDimensions: string[];
  candidatesTested: number;
}

const WEAK_THRESHOLD = 3.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getWeakDimensions(scope: PromptScope): Promise<{
  dimensions: DimensionAvg[];
  weak: DimensionAvg[];
  avgOverall: number;
  versionId: string | null;
}> {
  const active = await getActivePrompt(scope, "");
  const versionId = active.versionId;

  const condition = versionId
    ? sql`AND prompt_version_id = ${versionId}`
    : sql`AND prompt_version_id IS NULL`;

  const result = await db.execute(sql`
    SELECT
      ROUND(AVG(brand_compliance)::numeric, 2) as avg_brand,
      ROUND(AVG(view_angle)::numeric, 2) as avg_view,
      ROUND(AVG(composition)::numeric, 2) as avg_comp,
      ROUND(AVG(motif_accuracy)::numeric, 2) as avg_motif,
      ROUND(AVG(stone_rendering)::numeric, 2) as avg_stone,
      ROUND(AVG(gold_balance)::numeric, 2) as avg_gold,
      ROUND(AVG(overall_quality)::numeric, 2) as avg_overall,
      COUNT(*)::int as total
    FROM design_evaluations
    WHERE 1=1 ${condition}
  `);

  const row = result.rows[0] as Record<string, string> | undefined;
  if (!row || parseInt(row.total) === 0) {
    return { dimensions: [], weak: [], avgOverall: 0, versionId };
  }

  const dimensions: DimensionAvg[] = [
    { dimension: "brand_compliance", avg: parseFloat(row.avg_brand) },
    { dimension: "view_angle", avg: parseFloat(row.avg_view) },
    { dimension: "composition", avg: parseFloat(row.avg_comp) },
    { dimension: "motif_accuracy", avg: parseFloat(row.avg_motif) },
    { dimension: "stone_rendering", avg: parseFloat(row.avg_stone) },
    { dimension: "gold_balance", avg: parseFloat(row.avg_gold) },
    { dimension: "overall_quality", avg: parseFloat(row.avg_overall) },
  ];

  const weak = dimensions.filter(d => d.avg < WEAK_THRESHOLD);
  const avgOverall = parseFloat(row.avg_overall);

  return { dimensions, weak, avgOverall, versionId };
}

// ── AxGEPA Integration ───────────────────────────────────────────────────────

/**
 * Build the AxGen program whose instruction AxGEPA will optimize.
 * Signature: designRequest:string -> improvedPromptText:string
 * The "instruction" is the current BRAND_RULES / CAD_RULES prompt.
 * AxGEPA will evolve better instructions across trials.
 */
function buildPromptProgram(currentInstruction: string): AxGen {
  const program = new AxGen(
    'designCategory:string "jewellery category", designMotifs:string "comma-separated motifs", designStones:string "comma-separated stones", materialRatio:string "gold-to-stone ratio" -> generatedPromptText:string "complete image generation prompt"'
  );
  program.setInstruction(currentInstruction);
  return program;
}

/**
 * AxGEPA metric function. For each example:
 * 1. Take the program's output (the generated prompt text)
 * 2. Generate an image using that prompt
 * 3. Evaluate with the Vision judge
 * 4. Return a 0-1 score (overall_quality / 5.0)
 */
function buildMetricFn(weakDims: DimensionAvg[]): AxMetricFn {
  return async ({ prediction, example }) => {
    try {
      const promptText = String(
        (prediction as Record<string, unknown>).generatedPromptText || ""
      );
      if (!promptText || promptText.length < 50) return 0;

      const category = String((example as Record<string, unknown>).designCategory || "Necklace");
      const motifs = String((example as Record<string, unknown>).designMotifs || "Lotus")
        .split(",").map(s => s.trim());
      const stones = String((example as Record<string, unknown>).designStones || "Polki")
        .split(",").map(s => s.trim());
      const materialRatio = String((example as Record<string, unknown>).materialRatio || "Gold Intensive");

      // Generate an image with this prompt
      const imageUrl = await generateJewellerySketch(promptText);

      // Evaluate with Vision judge
      const scores = await evaluateDesignQuality(imageUrl, {
        category,
        motifs,
        stones,
        materialRatio,
        mode: "sketch",
      });

      if (!scores) return 0;

      // Weighted score: penalize weak dimensions more heavily
      const weakKeys = new Set(weakDims.map(d => d.dimension));
      const dimScores = [
        { key: "brand_compliance", val: scores.brandCompliance },
        { key: "view_angle", val: scores.viewAngle },
        { key: "composition", val: scores.composition },
        { key: "motif_accuracy", val: scores.motifAccuracy },
        { key: "stone_rendering", val: scores.stoneRendering },
        { key: "gold_balance", val: scores.goldBalance },
        { key: "overall_quality", val: scores.overallQuality },
      ];

      let weightedSum = 0;
      let totalWeight = 0;
      for (const d of dimScores) {
        const w = weakKeys.has(d.key) ? 2.0 : 1.0; // double weight for weak dims
        weightedSum += d.val * w;
        totalWeight += w;
      }

      // Normalize to 0-1 range
      const score = weightedSum / (totalWeight * 5.0);
      console.log(`[optimizer/metric] ${category}: score=${score.toFixed(3)}, overall=${scores.overallQuality}/5`);
      return score;
    } catch (error) {
      console.warn("[optimizer/metric] Evaluation failed:", error instanceof Error ? error.message : String(error));
      return 0;
    }
  };
}

// Training examples — diverse design requests for AxGEPA to test against
const TRAINING_EXAMPLES = [
  { designCategory: "Necklace", designMotifs: "Lotus, Paisley", designStones: "Polki", materialRatio: "Gold Intensive" },
  { designCategory: "Choker", designMotifs: "Peacock", designStones: "Polki, Emerald", materialRatio: "Polki Intensive" },
  { designCategory: "Ring", designMotifs: "Geometric", designStones: "Polki", materialRatio: "Gold Intensive" },
  { designCategory: "Bangle", designMotifs: "Lotus, Leaves", designStones: "Polki, Rubies", materialRatio: "Stone Intensive" },
  { designCategory: "Long Necklace Set", designMotifs: "Swan, Cluster Flowers", designStones: "Polki", materialRatio: "Polki Intensive" },
];

// ── Main Optimization Entry Point ────────────────────────────────────────────

export async function optimizePrompts(
  scope: PromptScope = "brand_rules"
): Promise<OptimizationResult> {
  const runResult = await db.execute(sql`
    INSERT INTO optimization_runs (id, scope, status)
    VALUES (gen_random_uuid(), ${scope}, 'running')
    RETURNING id
  `);
  const runId = (runResult.rows[0] as { id: string }).id;

  try {
    // Step 1: Identify weak dimensions
    const { weak, avgOverall, versionId } = await getWeakDimensions(scope);

    if (weak.length === 0) {
      console.log(`[optimizer] No weak dimensions for ${scope} (all >= ${WEAK_THRESHOLD}). Skipping.`);
      await db.execute(sql`
        UPDATE optimization_runs
        SET status = 'completed', completed_at = NOW(),
            before_avg_score = ${Math.round(avgOverall * 100)},
            after_avg_score = ${Math.round(avgOverall * 100)},
            candidates_tested = 0,
            before_version_id = ${versionId}
        WHERE id = ${runId}
      `);
      return { runId, scope, beforeScore: avgOverall, afterScore: avgOverall, improved: false, newVersionId: null, weakDimensions: [], candidatesTested: 0 };
    }

    console.log(`[optimizer] Weak dims for ${scope}: ${weak.map(w => `${w.dimension}=${w.avg.toFixed(2)}`).join(", ")}`);

    // Step 2: Load current prompt as initial instruction
    const current = await getActivePrompt(scope, "");
    if (!current.text) throw new Error(`No active prompt for scope: ${scope}`);

    // Step 3: Build AxGEPA optimizer + program
    const studentAI = new AxAI({
      name: "google-gemini",
      apiKey: process.env.GEMINI_API_KEY || "",
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
    });

    const optimizer = new AxGEPA({
      studentAI,
      numTrials: 3,          // 3 evolutionary trials (each tests a candidate instruction)
      earlyStoppingTrials: 2, // stop if no improvement after 2 trials
      minImprovementThreshold: 0.01,
    });

    const program = buildPromptProgram(current.text);
    const metricFn = buildMetricFn(weak);

    console.log(`[optimizer] Starting AxGEPA optimization (3 trials, 5 examples)...`);

    // Step 4: Run AxGEPA compile — this is the evolutionary optimization loop
    const axResult = await optimizer.compile(
      program,
      TRAINING_EXAMPLES,
      metricFn,
      {
        maxMetricCalls: 15,   // max 15 image generations total (3 trials × 5 examples)
        maxIterations: 3,
        auto: "light",
        verbose: true,
      }
    );

    // Step 5: Extract the optimized instruction
    const optimizedInstruction = program.getInstruction() || current.text;
    const stats = optimizer.getStats();
    const bestScore = stats.bestScore ?? 0;
    const candidatesTested = stats.totalCalls ?? 1;

    console.log(`[optimizer] AxGEPA done: bestScore=${bestScore.toFixed(3)}, trials=${candidatesTested}`);

    // Convert 0-1 score back to 1-5 scale for comparison
    const afterScore5 = bestScore * 5.0;
    const improved = afterScore5 > avgOverall;

    let newVersionId: string | null = null;

    if (improved) {
      const maxVer = await db.execute(sql`
        SELECT COALESCE(MAX(version_number), 0)::int as max_ver FROM prompt_versions WHERE scope = ${scope}
      `);
      const nextVersion = ((maxVer.rows[0] as { max_ver: number }).max_ver) + 1;

      const newVersion = await storage.createPromptVersion({
        versionNumber: nextVersion,
        scope,
        templateText: optimizedInstruction,
        avgOverallScore: Math.round(afterScore5 * 100),
        generationCount: 0,
        isActive: 0,
        parentVersionId: versionId,
      });

      newVersionId = newVersion.id;
      await activatePromptVersion(newVersionId, scope);
      console.log(`[optimizer] Promoted AxGEPA-optimized version v${nextVersion} for ${scope}`);
    } else {
      console.log(`[optimizer] AxGEPA candidate did not improve (${afterScore5.toFixed(2)} vs ${avgOverall.toFixed(2)}). Keeping current.`);
    }

    await db.execute(sql`
      UPDATE optimization_runs
      SET status = 'completed', completed_at = NOW(),
          before_avg_score = ${Math.round(avgOverall * 100)},
          after_avg_score = ${Math.round(afterScore5 * 100)},
          weak_dimensions = ${weak.map(w => w.dimension)},
          candidates_tested = ${candidatesTested},
          before_version_id = ${versionId},
          after_version_id = ${newVersionId}
      WHERE id = ${runId}
    `);

    return {
      runId, scope,
      beforeScore: avgOverall,
      afterScore: afterScore5,
      improved,
      newVersionId,
      weakDimensions: weak.map(w => w.dimension),
      candidatesTested,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[optimizer] Optimization failed:`, msg);
    await db.execute(sql`
      UPDATE optimization_runs
      SET status = 'failed', completed_at = NOW(), error_message = ${msg}
      WHERE id = ${runId}
    `).catch(() => {});
    throw error;
  }
}
