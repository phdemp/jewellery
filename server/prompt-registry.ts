// server/prompt-registry.ts
// Loads active prompt version per scope with fallback to hardcoded constants.
// Scopes: "brand_rules" | "cad_rules" | "grok_preamble"

import { db } from "./db";
import { sql } from "drizzle-orm";

export type PromptScope = "brand_rules" | "cad_rules" | "grok_preamble";

interface ActivePromptResult {
  id: string;
  template_text: string;
  version_number: number;
}

// In-memory cache — invalidated on version change
const cache: Map<PromptScope, { id: string; text: string; version: number }> = new Map();

/**
 * Get the active prompt text for a given scope.
 * Falls back to the provided default if no active version exists in DB.
 * Never throws — returns fallback on any error.
 */
export async function getActivePrompt(
  scope: PromptScope,
  fallback: string
): Promise<{ text: string; versionId: string | null }> {
  try {
    // Check cache first
    const cached = cache.get(scope);
    if (cached) {
      return { text: cached.text, versionId: cached.id };
    }

    const result = await db.execute(sql`
      SELECT id, template_text, version_number
      FROM prompt_versions
      WHERE scope = ${scope} AND is_active = 1
      ORDER BY version_number DESC
      LIMIT 1
    `);

    const row = result.rows[0] as unknown as ActivePromptResult | undefined;
    if (!row) {
      return { text: fallback, versionId: null };
    }

    // Cache it
    cache.set(scope, { id: row.id, text: row.template_text, version: row.version_number });

    return { text: row.template_text, versionId: row.id };
  } catch (error) {
    console.warn(
      `[prompt-registry] Failed to load active prompt for ${scope}, using fallback:`,
      error instanceof Error ? error.message : String(error)
    );
    return { text: fallback, versionId: null };
  }
}

/**
 * Invalidate cache for a scope (call after activating a new version).
 */
export function invalidatePromptCache(scope?: PromptScope): void {
  if (scope) {
    cache.delete(scope);
  } else {
    cache.clear();
  }
}

/**
 * Seed initial prompt versions from hardcoded constants.
 * Only inserts if no versions exist for the scope.
 * Called once on server startup.
 */
export async function seedPromptVersions(
  seeds: Array<{ scope: PromptScope; text: string }>
): Promise<void> {
  try {
    for (const seed of seeds) {
      const existing = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM prompt_versions WHERE scope = ${seed.scope}
      `);
      const count = (existing.rows[0] as { cnt: number })?.cnt ?? 0;
      if (count === 0) {
        await db.execute(sql`
          INSERT INTO prompt_versions (id, version_number, scope, template_text, is_active, generation_count)
          VALUES (gen_random_uuid(), 1, ${seed.scope}, ${seed.text}, 1, 0)
        `);
        console.log(`[prompt-registry] Seeded version 1 for scope: ${seed.scope}`);
      }
    }
  } catch (error) {
    console.warn(
      "[prompt-registry] Seeding failed (table may not exist yet):",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Increment generation count for the active version of a scope.
 */
export async function incrementGenerationCount(versionId: string | null): Promise<void> {
  if (!versionId) return;
  try {
    await db.execute(sql`
      UPDATE prompt_versions SET generation_count = generation_count + 1 WHERE id = ${versionId}
    `);
  } catch (error) {
    // Non-critical — don't throw
    console.warn("[prompt-registry] Failed to increment generation count:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Activate a specific prompt version and deactivate all others for the same scope.
 */
export async function activatePromptVersion(versionId: string, scope: PromptScope): Promise<void> {
  await db.execute(sql`
    UPDATE prompt_versions SET is_active = 0 WHERE scope = ${scope}
  `);
  await db.execute(sql`
    UPDATE prompt_versions SET is_active = 1 WHERE id = ${versionId}
  `);
  invalidatePromptCache(scope);
}
