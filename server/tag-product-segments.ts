/**
 * Populate product_segment on reference_images from VA metadata or theme_code mapping.
 * Usage: npx tsx --env-file=.env server/tag-product-segments.ts
 */

import { Pool } from "pg";

const THEME_TO_SEGMENT: Record<string, string> = {
  BRP: "Bridal", BRC: "Bridal", BRU: "Bridal", BRD: "Bridal", BRO: "Bridal",
  CLO: "Traditional", CLC: "Traditional", CLD: "Traditional", CLP: "Exclusive - Grandeur",
  WRO: "Traditional", WRD: "Modern", WRC: "Traditional", WRP: "Traditional",
  SOP: "Exclusive - Grandeur", SOO: "Modern", SOD: "Modern",
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const refs = await pool.query(
    "SELECT id, theme_code, metadata FROM reference_images WHERE product_segment IS NULL AND theme_code IS NOT NULL"
  );
  console.log(`Refs with theme_code but no product_segment: ${refs.rows.length}`);

  let updated = 0;
  for (const row of refs.rows) {
    const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;

    // Try VA metadata Product_Segment first
    let segment: string | null = meta?.Product_Segment || null;

    // Fallback to theme code mapping
    if (!segment && row.theme_code) {
      segment = THEME_TO_SEGMENT[row.theme_code] || null;
    }

    // Also populate category from VA metadata if missing
    const category: string | null = meta?.VA_Category || meta?.Category || null;

    if (segment) {
      if (category) {
        await pool.query(
          "UPDATE reference_images SET product_segment = $1, category = COALESCE(category, $2) WHERE id = $3",
          [segment, category, row.id]
        );
      } else {
        await pool.query(
          "UPDATE reference_images SET product_segment = $1 WHERE id = $2",
          [segment, row.id]
        );
      }
      updated++;
    }
  }

  console.log(`Updated: ${updated}`);

  const final = await pool.query(
    "SELECT product_segment, COUNT(*) as c FROM reference_images GROUP BY product_segment ORDER BY c DESC"
  );
  console.log("\nFinal product_segment distribution:");
  for (const r of final.rows) console.log(`  ${r.product_segment || "NULL"}: ${r.c}`);

  const remaining = await pool.query(
    "SELECT COUNT(*) as c FROM reference_images WHERE product_segment IS NULL"
  );
  console.log(`\nStill untagged: ${remaining.rows[0].c}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
