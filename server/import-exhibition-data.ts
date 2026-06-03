/**
 * Import exhibition SKU interest data from EXHIBITION-SKU-DIGL.xlsx
 * Sheet 1: "B2B EXHIBITION SKU" — 4724 rows with full fields
 * Sheet 2: "B2C EXHIBITION SKU" — 477 rows (SOURCE NAME + style code only)
 *
 * Usage: npx tsx --env-file=.env server/import-exhibition-data.ts
 */

import XLSX from "xlsx";
import { Pool } from "pg";

interface B2BExhibitionRow {
  EntryDate: number;
  CustomerName: string;
  StyleCode: string;
  Jewel_Code: string | number;
  GrossWt: number;
  MakeTypeName: string;
  ParentStyleCode: string;
  SalesPersonName: string;
  BaseMetal: string;
  PureWt: number;
  Category: string;
  InwardTagPrice: number;
  "EXHIBITION NAME": string;
}

interface B2CExhibitionRow {
  "SOURCE NAME": string;
  [key: string]: unknown;
}

function str(val: unknown): string | null {
  if (val === undefined || val === null || val === "") return null;
  return String(val).trim();
}

function int(val: unknown): number | null {
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

async function main() {
  console.log("Reading EXHIBITION-SKU-DIGL.xlsx...");
  const wb = XLSX.readFile("EXHIBITION-SKU-DIGL.xlsx");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Create table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exhibition_sku_interests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      exhibition_name TEXT NOT NULL,
      customer_name TEXT,
      style_code TEXT,
      jewel_code TEXT,
      parent_style_code TEXT,
      category TEXT,
      make_type TEXT,
      gross_wt TEXT,
      pure_wt TEXT,
      tag_price INTEGER,
      sales_person_name TEXT,
      base_metal TEXT,
      source TEXT NOT NULL DEFAULT 'b2b',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  // Clear existing
  const existing = await pool.query("SELECT COUNT(*) as c FROM exhibition_sku_interests");
  if (Number(existing.rows[0].c) > 0) {
    console.log(`Clearing ${existing.rows[0].c} existing rows...`);
    await pool.query("DELETE FROM exhibition_sku_interests");
  }

  let totalInserted = 0;
  let totalErrors = 0;

  // ── Sheet 1: B2B Exhibition SKU ──
  const sheet1Name = wb.SheetNames[0];
  console.log(`\nProcessing sheet: "${sheet1Name}"...`);
  const ws1 = wb.Sheets[sheet1Name];
  const b2bRows = XLSX.utils.sheet_to_json<B2BExhibitionRow>(ws1);
  console.log(`Read ${b2bRows.length} B2B rows`);

  const CHUNK = 500;
  for (let i = 0; i < b2bRows.length; i += CHUNK) {
    const chunk = b2bRows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const exhibitionName = str(row["EXHIBITION NAME"]);
      if (!exhibitionName) { totalErrors++; continue; }

      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(
        exhibitionName,
        str(row.CustomerName),
        str(row.StyleCode),
        str(row.Jewel_Code),
        str(row.ParentStyleCode),
        str(row.Category),
        str(row.MakeTypeName),
        str(row.GrossWt),
        str(row.PureWt),
        int(row.InwardTagPrice),
        str(row.SalesPersonName),
        str(row.BaseMetal),
        "b2b",
      );
    }

    if (values.length === 0) continue;

    try {
      await pool.query(
        `INSERT INTO exhibition_sku_interests (
          exhibition_name, customer_name, style_code, jewel_code,
          parent_style_code, category, make_type, gross_wt, pure_wt,
          tag_price, sales_person_name, base_metal, source
        ) VALUES ${values.join(", ")}`,
        params
      );
      totalInserted += values.length;
    } catch (err) {
      totalErrors += chunk.length;
      console.error(`Error inserting B2B chunk at row ${i}:`, err instanceof Error ? err.message : err);
    }

    if ((i + CHUNK) % 1000 === 0 || i + CHUNK >= b2bRows.length) {
      console.log(`B2B progress: ${Math.min(i + CHUNK, b2bRows.length)}/${b2bRows.length}`);
    }
  }

  // ── Sheet 2: B2C Exhibition SKU ──
  if (wb.SheetNames.length >= 2) {
    const sheet2Name = wb.SheetNames[1];
    console.log(`\nProcessing sheet: "${sheet2Name}"...`);
    const ws2 = wb.Sheets[sheet2Name];
    const b2cRows = XLSX.utils.sheet_to_json<B2CExhibitionRow>(ws2);
    console.log(`Read ${b2cRows.length} B2C rows`);

    // B2C sheet has SOURCE NAME as exhibition name, and style code columns may vary
    // We'll extract what we can
    for (let i = 0; i < b2cRows.length; i += CHUNK) {
      const chunk = b2cRows.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: (string | number | null)[] = [];
      let paramIdx = 1;

      for (const row of chunk) {
        const exhibitionName = str(row["SOURCE NAME"]);
        if (!exhibitionName) { totalErrors++; continue; }

        // Try to find style code from various column names
        const styleCode = str(row["StyleCode"] || row["Style Code"] || row["STYLE CODE"] || row["SKU"]);

        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(exhibitionName, styleCode, "b2c");
      }

      if (values.length === 0) continue;

      try {
        await pool.query(
          `INSERT INTO exhibition_sku_interests (exhibition_name, style_code, source) VALUES ${values.join(", ")}`,
          params
        );
        totalInserted += values.length;
      } catch (err) {
        totalErrors += chunk.length;
        console.error(`Error inserting B2C chunk at row ${i}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Summary stats
  const exhStats = await pool.query(
    "SELECT exhibition_name, COUNT(*) as c, COUNT(DISTINCT customer_name) as customers FROM exhibition_sku_interests GROUP BY exhibition_name ORDER BY c DESC"
  );
  console.log("\n=== Exhibition Summary ===");
  for (const row of exhStats.rows) {
    console.log(`  ${row.exhibition_name}: ${row.c} interests, ${row.customers} unique customers`);
  }

  const catStats = await pool.query(
    "SELECT category, COUNT(*) as c FROM exhibition_sku_interests WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC LIMIT 10"
  );
  console.log("\n=== Top Categories ===");
  for (const row of catStats.rows) {
    console.log(`  ${row.category}: ${row.c}`);
  }

  console.log(`\n=== Final ===`);
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Errors/skipped: ${totalErrors}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
