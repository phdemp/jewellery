/**
 * Tag untagged reference_images with theme_code derived from:
 * 1. metadata.Sub_Category + metadata.Stock_Type (Type B — bulk Drive imports)
 * 2. Filename pattern parsing (Type A — manual uploads)
 *
 * Usage: npx tsx --env-file=.env server/tag-reference-images.ts
 */

import { Pool } from "pg";

const THEME_CODE_MAP: Record<string, string> = {
  "BRIDAL/CLASSIC": "BRC",
  "BRIDAL/PREMIUM": "BRP",
  "BRIDAL/UNIQUE": "BRU",
  "BRIDAL/DAILY": "BRD",
  "BRIDAL/OCCASIONABLE": "BRO",
  "WEARABLE/DAILY": "WRD",
  "WEARABLE/OCCASIONABLE": "WRO",
  "WEARABLE/CLASSIC": "WRC",
  "WEARABLE/PREMIUM": "WRP",
  "COLLECTABLE/OCCASIONABLE": "CLO",
  "COLLECTABLE/CLASSIC": "CLC",
  "COLLECTABLE/DAILY": "CLD",
  "COLLECTABLE/PREMIUM": "CLP",
  "SOLITAIRE/DAILY": "SOD",
  "SOLITAIRE/OCCASIONABLE": "SOO",
  "SOLITAIRE/PREMIUM": "SOP",
};

// Filename prefixes → theme codes
// Patterns: O(Q)BRC, O(Q)WRD, O(Q)CLO, O(Q)CLP, OSOL(D/O/P), J/D/F prefix variants
const FILENAME_PATTERNS: [RegExp, string][] = [
  // Standard: O(Q)XXX or J/D/F prefix
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)BRC/i, "BRC"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)BRP/i, "BRP"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)BRU/i, "BRU"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)WRD/i, "WRD"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)WRO/i, "WRO"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)CLO/i, "CLO"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)CLP/i, "CLP"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)CLC/i, "CLC"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)SOL?D/i, "SOD"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)SOL?O/i, "SOO"],
  [/(?:^|[_\s])(?:O?Q?|J|D|F|MALA)SOL?P/i, "SOP"],
  // QCLBRC pattern
  [/QCL\s*BRC/i, "BRC"],
  [/QCL\s*BRP/i, "BRP"],
  // Descriptive names in filename
  [/COLLETABLE[- ]*OCCASIONABLE/i, "CLO"],
  [/COLLECTABLE[- ]*OCCASIONABLE/i, "CLO"],
  [/BRIDAL[- ]*CLASSIC/i, "BRC"],
  [/BRIDAL[- ]*PREMIUM/i, "BRP"],
  [/WEARABLE[- ]*DAILY/i, "WRD"],
  [/WEARABLE[- ]*OCCASIONABLE/i, "WRO"],
];

function deriveFromMetadata(metadata: Record<string, unknown>): string | null {
  const sub = String(metadata.Sub_Category || "").trim().toUpperCase();
  const stock = String(metadata.Stock_Type || "").trim().toUpperCase();
  if (!sub || !stock || sub === "UNDEFINED" || stock === "UNDEFINED") return null;
  return THEME_CODE_MAP[`${sub}/${stock}`] || null;
}

function deriveFromFilename(filename: string): string | null {
  for (const [pattern, code] of FILENAME_PATTERNS) {
    if (pattern.test(filename)) return code;
  }
  return null;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Get all untagged reference images
  const result = await pool.query(
    "SELECT id, filename, metadata FROM reference_images WHERE theme_code IS NULL OR theme_code = ''"
  );
  const items = result.rows as { id: string; filename: string; metadata: Record<string, unknown> }[];
  console.log(`Untagged reference images: ${items.length}`);

  let taggedFromMeta = 0;
  let taggedFromFilename = 0;
  let stillUntagged = 0;
  const themeCodeCounts: Record<string, number> = {};

  for (const item of items) {
    const meta = typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata;

    // Try metadata first (most accurate)
    let code = meta ? deriveFromMetadata(meta) : null;
    let source = "metadata";

    // Fallback to filename pattern
    if (!code) {
      code = deriveFromFilename(item.filename);
      source = "filename";
    }

    if (code) {
      await pool.query("UPDATE reference_images SET theme_code = $1 WHERE id = $2", [code, item.id]);
      themeCodeCounts[code] = (themeCodeCounts[code] || 0) + 1;
      if (source === "metadata") taggedFromMeta++;
      else taggedFromFilename++;
    } else {
      stillUntagged++;
    }
  }

  // Show results
  console.log(`\nTagged from metadata: ${taggedFromMeta}`);
  console.log(`Tagged from filename: ${taggedFromFilename}`);
  console.log(`Still untagged: ${stillUntagged}`);

  console.log("\n=== New Tags Applied ===");
  const sorted = Object.entries(themeCodeCounts).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sorted) console.log(`  ${code}: ${count}`);

  // Final distribution
  const final = await pool.query(
    "SELECT theme_code, COUNT(*) as c FROM reference_images GROUP BY theme_code ORDER BY c DESC"
  );
  console.log("\n=== Final Theme Distribution ===");
  for (const row of final.rows) console.log(`  ${row.theme_code || "NULL"}: ${row.c}`);

  const remaining = await pool.query(
    "SELECT COUNT(*) as c FROM reference_images WHERE theme_code IS NULL OR theme_code = ''"
  );
  console.log(`\nRemaining untagged: ${remaining.rows[0].c}`);

  // Show untagged filenames if any remain
  if (parseInt(remaining.rows[0].c) > 0) {
    const untagged = await pool.query(
      "SELECT filename FROM reference_images WHERE theme_code IS NULL OR theme_code = '' LIMIT 20"
    );
    console.log("\nSample still-untagged:");
    for (const r of untagged.rows) console.log("  " + r.filename);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
